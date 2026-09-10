package peer

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"convenewire.dev/bridge/internal/privatefs"
)

func writeNativeTLSFixture(t *testing.T, root string, f *peerHTTPFixture) (string, []byte) {
	t.Helper()
	directory := filepath.Join(root, "peer-tls", f.Host.NodeID)
	if err := privatefs.EnsureDirectory(filepath.Join(root, "peer-tls")); err != nil {
		t.Fatal(err)
	}
	if err := privatefs.CreateDirectory(directory); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(NativeTLSConfiguration{SchemaVersion: 1, Host: f.Host, HostOrigin: f.Origin, CACertificatePEM: string(f.certificatePEM)})
	path := filepath.Join(directory, "config.json")
	if err := privatefs.WriteFile(path, raw); err != nil {
		t.Fatal(err)
	}
	return path, raw
}

func TestNativePeerTLSIsExplicitScopedAndNeverFallsBackOnBrokenConfiguration(t *testing.T) {
	f, original, store, receipt, _ := runtimeTLSParticipant(t)
	root := filepath.Dir(store.directory)
	client, err := NewNativeClient(root, f.Origin, f.Host, original.signer, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	client.clock = original.clock
	if _, err := client.ConnectRuntime(context.Background(), store, receipt.Membership.MembershipID); err == nil {
		t.Fatal("private fixture CA implicitly trusted")
	}
	client.Close()
	if _, err := os.Lstat(filepath.Join(root, "peer-tls")); !os.IsNotExist(err) {
		t.Fatal("trust read wrote a configuration", err)
	}
	path, raw := writeNativeTLSFixture(t, root, f)
	client, err = NewNativeClient(root, f.Origin, f.Host, original.signer, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	client.clock = original.clock
	connection, err := client.ConnectRuntime(context.Background(), store, receipt.Membership.MembershipID)
	if err != nil {
		t.Fatal("explicit private CA did not reach actual TLS/WS", err)
	}
	defer connection.Close()
	if err := connection.Heartbeat(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := connection.Heartbeat(context.Background()); !errors.Is(err, ErrTLSConfiguration) {
		t.Fatal("removed TLS configuration retained live transport", err)
	}
	waitRuntimeClosed(t, connection)
	if _, err := NewNativeClient(root, f.Origin, f.Host, original.signer, func() error { return nil }); !errors.Is(err, ErrTLSConfiguration) {
		t.Fatal("missing private config fell back to OS trust", err)
	}
	if err := privatefs.WriteFile(path, raw); err != nil {
		t.Fatal(err)
	}
	for _, change := range []string{"origin", "key", "schema", "unknown", "duplicate", "leading text", "extra certificate", "private key", "link", "mode"} {
		t.Run(change, func(t *testing.T) {
			if change == "mode" && runtime.GOOS == "windows" {
				t.Skip("POSIX permissions; native Windows ACL suite owns DACL checks")
			}
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			var cfg map[string]any
			if err := json.Unmarshal(raw, &cfg); err != nil {
				t.Fatal(err)
			}
			switch change {
			case "origin":
				cfg["hostOrigin"] = "https://different.example"
			case "key":
				cfg["host"].(map[string]any)["publicKey"] = original.signer.Identity().PublicKey
			case "schema":
				cfg["schemaVersion"] = 2
			case "unknown":
				cfg["deviceId"] = "device_unrelated001"
			case "leading text":
				cfg["caCertificatePem"] = "unexpected text" + string(f.certificatePEM)
			case "extra certificate":
				cfg["caCertificatePem"] = string(f.certificatePEM) + string(f.certificatePEM)
			case "private key":
				cfg["caCertificatePem"] = strings.ReplaceAll(string(f.certificatePEM), "CERTIFICATE", "PRIVATE KEY")
			}
			value, _ := json.Marshal(cfg)
			if change == "duplicate" {
				value = append([]byte("{\"schemaVersion\":1,"), value[1:]...)
			}
			if change == "link" {
				outside := filepath.Join(t.TempDir(), "config.json")
				if err := os.WriteFile(outside, raw, 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(outside, path); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := privatefs.WriteFile(path, value); err != nil {
					t.Fatal(err)
				}
				if change == "mode" {
					if err := os.Chmod(path, 0644); err != nil {
						t.Fatal(err)
					}
				}
			}
			if _, err := NewNativeClient(root, f.Origin, f.Host, original.signer, func() error { return nil }); !errors.Is(err, ErrTLSConfiguration) {
				t.Fatal("invalid scoped TLS configuration accepted", change, err)
			}
		})
	}
}
