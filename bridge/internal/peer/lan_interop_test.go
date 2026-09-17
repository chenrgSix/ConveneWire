package peer

import (
	"bufio"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"io"
	"net"
	"os"
	"testing"
	"time"
)

// Test-only transport for fixture control. Product requests still use the
// production Client and actual native PeerIngress over ordinary verified TLS.
func remoteLANPeerFixture(t *testing.T, now time.Time, filename string) *peerHTTPFixture {
	t.Helper()
	var cfg struct{ Address, Token, CACertificatePEM string }
	raw, err := os.ReadFile(filename)
	if err != nil || len(raw) > 32*1024 || json.Unmarshal(raw, &cfg) != nil || len(cfg.Token) != 43 {
		t.Fatal("invalid explicit LAN fixture manifest")
	}
	host, _, err := net.SplitHostPort(cfg.Address)
	ip := net.ParseIP(host)
	if err != nil || ip == nil || !(ip.IsPrivate() || ip.IsLoopback()) {
		t.Fatal("LAN fixture requires a private address")
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(cfg.CACertificatePEM)) {
		t.Fatal("invalid LAN fixture CA")
	}
	connection, err := tls.DialWithDialer(&net.Dialer{Timeout: 5 * time.Second}, "tcp", cfg.Address,
		&tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12})
	if err != nil {
		t.Fatal("LAN fixture TLS", err)
	}
	t.Cleanup(func() {
		_ = connection.SetWriteDeadline(time.Now().Add(3 * time.Second))
		_, _ = io.WriteString(connection, "{\"action\":\"stop\"}\n")
		_ = connection.Close()
	})
	_ = connection.SetDeadline(time.Now().Add(30 * time.Second))
	if err := json.NewEncoder(connection).Encode(map[string]string{"token": cfg.Token, "now": now.Format(peerTimeFormat), "test": t.Name()}); err != nil {
		t.Fatal(err)
	}
	scanner := bufio.NewScanner(connection)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	if !scanner.Scan() {
		t.Fatal("LAN fixture did not become ready", scanner.Err())
	}
	var f peerHTTPFixture
	if json.Unmarshal(scanner.Bytes(), &f) != nil || f.Origin == "" || f.RelayAddress != "" {
		t.Fatal("invalid LAN fixture identity")
	}
	_ = connection.SetDeadline(time.Time{})
	f.roots, f.certificatePEM, f.input, f.lines = roots, []byte(cfg.CACertificatePEM), connection, scanner
	t.Logf("Physical Participant %s/%s -> %s", os.Getenv("OS"), os.Getenv("PROCESSOR_ARCHITECTURE"), f.Origin)
	return &f
}
