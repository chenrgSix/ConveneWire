package relay

import (
	"bufio"
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

func TestRegisteredPrecedesConcurrentPublicOpen(t *testing.T) {
	f := newFixture(t, func(c *Config) { c.OpenTimeout = 250 * time.Millisecond })
	for iteration := 0; iteration < 8; iteration++ {
		public, private, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		key := base64.RawURLEncoding.EncodeToString(public)
		hostname, _ := wire.RelayHostname(key, "nodes.relay.test")
		conn, err := f.dial("/v1/relay/control", nil)
		if err != nil {
			t.Fatal(err)
		}
		var challenge wire.RelayChallenge
		if err = f.read(conn, "RelayChallenge", &challenge); err != nil {
			t.Fatal(err)
		}
		transcript, _ := wire.RelayRegistrationTranscript(f.origin, "nodes.relay.test", challenge.Nonce, "node_raced001", key)
		registration := wire.RelayRegister{SchemaVersion: 1, Type: wire.Register, NodeID: "node_raced001", PublicKey: key, Signature: base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, transcript))}
		var requests sync.WaitGroup
		for index := 0; index < 8; index++ {
			requests.Add(1)
			go func() {
				defer requests.Done()
				source, err := net.DialTimeout("tcp", f.address, time.Second)
				if err != nil {
					return
				}
				defer source.Close()
				source.SetDeadline(time.Now().Add(time.Second))
				source.Write(helloBytes(hostname))
				source.Read(make([]byte, 1))
			}()
		}
		if err = send(f.ctx, conn, registration); err != nil {
			t.Fatal(err)
		}
		var registered wire.RelayRegistered
		if err = f.read(conn, "RelayRegistered", &registered); err != nil {
			t.Fatal("public open overtook registered response", err)
		}
		if registered.Hostname != hostname {
			t.Fatal("registered incorrect concurrent route")
		}
		conn.CloseNow()
		requests.Wait()
		waitFor(t, func() bool { return f.server.Stats().Nodes == 0 })
	}
}

func TestCLISIGTERMClosesListenerAndExits(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("SIGTERM is exercised on Unix; Windows library lifecycle uses the same Close path")
	}
	directory := t.TempDir()
	executable := filepath.Join(directory, "convenewire-relay")
	build := exec.Command("go", "build", "-o", executable, "./cmd/convenewire-relay")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build CLI: %v %s", err, output)
	}
	cert, _ := testCertificates(t)
	key, err := x509.MarshalPKCS8PrivateKey(cert.PrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	certificatePath, keyPath := filepath.Join(directory, "control.pem"), filepath.Join(directory, "key.pem")
	if err = os.WriteFile(certificatePath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Certificate[0]}), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key}), 0600); err != nil {
		t.Fatal(err)
	}
	command := exec.Command(executable, "--relay-origin", "https://relay.control.test", "--node-domain", "nodes.relay.test", "--tls-listen", "127.0.0.1:0", "--http-listen", "127.0.0.1:0", "--tls-cert", certificatePath, "--tls-key", keyPath)
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	var waitErr error
	go func() { waitErr = command.Wait(); close(done) }()
	t.Cleanup(func() {
		command.Process.Kill()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("Relay CLI did not stop")
		}
	})
	ready := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		if scanner.Scan() {
			ready <- scanner.Text()
		} else {
			ready <- ""
		}
	}()
	var line string
	select {
	case line = <-ready:
	case <-time.After(5 * time.Second):
		t.Fatal("Relay CLI did not announce readiness")
	}
	if !strings.HasPrefix(line, "Relay ready tls=127.0.0.1:") {
		t.Fatal("invalid Relay readiness line")
	}
	parts := strings.Fields(line)
	tlsAddress := strings.TrimPrefix(parts[2], "tls=")
	httpAddress := strings.TrimPrefix(parts[3], "http01=")
	probe := exec.Command(executable, "healthcheck", "--relay-origin", "https://relay.control.test", "--tls-address", tlsAddress, "--http-address", httpAddress, "--ca-file", certificatePath)
	if output, err := probe.CombinedOutput(); err != nil {
		t.Fatalf("CLI healthcheck: %v %s", err, output)
	}
	if err = command.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
		if waitErr != nil {
			t.Fatalf("SIGTERM exit: %v %s", waitErr, stderr.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("SIGTERM did not stop Relay")
	}
	for _, address := range []string{tlsAddress, httpAddress} {
		conn, err := net.DialTimeout("tcp", address, 100*time.Millisecond)
		if err == nil {
			conn.Close()
			t.Fatal("CLI left listener open")
		}
	}
}
