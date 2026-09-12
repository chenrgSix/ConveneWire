package relay

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
	"github.com/coder/websocket"
)

type fixture struct {
	t           *testing.T
	server      *Server
	origin      string
	address     string
	httpAddress string
	client      *http.Client
	cert        tls.Certificate
	roots       *x509.CertPool
	ctx         context.Context
	cancel      context.CancelFunc
}

func testCertificates(t *testing.T) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Relay fixture CA"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	caDER, err := x509.CreateCertificate(rand.Reader, ca, ca, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	caParsed, err := x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatal(err)
	}
	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	leaf := &x509.Certificate{SerialNumber: big.NewInt(2), DNSNames: []string{"relay.control.test", "*.nodes.relay.test"}, NotBefore: ca.NotBefore, NotAfter: ca.NotAfter, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	leafDER, err := x509.CreateCertificate(rand.Reader, leaf, caParsed, &leafKey.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	pk, err := x509.MarshalPKCS8PrivateKey(leafKey)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := tls.X509KeyPair(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leafDER}), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pk}))
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(caParsed)
	return cert, roots
}

func newFixture(t *testing.T, mutate func(*Config)) *fixture {
	t.Helper()
	cert, roots := testCertificates(t)
	public, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	challenge, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		public.Close()
		t.Fatal(err)
	}
	_, port, _ := net.SplitHostPort(public.Addr().String())
	origin := "https://relay.control.test:" + port
	config := Config{RelayOrigin: origin, NodeDomain: "nodes.relay.test", ControlTLS: &tls.Config{Certificates: []tls.Certificate{cert}}, HandshakeTimeout: 2 * time.Second, OpenTimeout: time.Second, IdleTimeout: 3 * time.Second, PingInterval: 100 * time.Millisecond, PingTimeout: time.Second}
	if mutate != nil {
		mutate(&config)
	}
	server, err := New(config)
	if err != nil {
		public.Close()
		challenge.Close()
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, public.Addr().String())
	}, ForceAttemptHTTP2: false}
	f := &fixture{t: t, server: server, origin: origin, address: public.Addr().String(), httpAddress: challenge.Addr().String(), client: &http.Client{Transport: transport}, cert: cert, roots: roots, ctx: ctx, cancel: cancel}
	done := make(chan error, 1)
	go func() { done <- server.Serve(public, challenge) }()
	t.Cleanup(func() {
		cancel()
		server.Close()
		transport.CloseIdleConnections()
		select {
		case err := <-done:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(6 * time.Second):
			t.Error("Relay did not drain")
		}
	})
	return f
}

func (f *fixture) dial(path string, headers http.Header) (*websocket.Conn, error) {
	ctx, cancel := context.WithTimeout(f.ctx, 3*time.Second)
	defer cancel()
	conn, response, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(f.origin, "https")+path, &websocket.DialOptions{HTTPClient: f.client, HTTPHeader: headers, CompressionMode: websocket.CompressionDisabled})
	if response != nil && response.Body != nil {
		response.Body.Close()
	}
	return conn, err
}

func (f *fixture) read(conn *websocket.Conn, kind string, target any) error {
	ctx, cancel := context.WithTimeout(f.ctx, 3*time.Second)
	defer cancel()
	typeValue, raw, err := conn.Read(ctx)
	if err != nil {
		return err
	}
	if typeValue != websocket.MessageText {
		return io.ErrUnexpectedEOF
	}
	return wire.Decode(kind, raw, target)
}

type fixtureNode struct {
	socket       *websocket.Conn
	registered   wire.RelayRegistered
	registration wire.RelayRegister
	private      ed25519.PrivateKey
}

func (f *fixture) register(private ed25519.PrivateKey) *fixtureNode {
	f.t.Helper()
	if private == nil {
		_, private, _ = ed25519.GenerateKey(rand.Reader)
	}
	socket, err := f.dial("/v1/relay/control", nil)
	if err != nil {
		f.t.Fatal(err)
	}
	f.t.Cleanup(func() { socket.CloseNow() })
	var challenge wire.RelayChallenge
	if err = f.read(socket, "RelayChallenge", &challenge); err != nil {
		f.t.Fatal(err)
	}
	public := base64.RawURLEncoding.EncodeToString(private.Public().(ed25519.PublicKey))
	transcript, err := wire.RelayRegistrationTranscript(f.origin, "nodes.relay.test", challenge.Nonce, "node_fixture01", public)
	if err != nil {
		f.t.Fatal(err)
	}
	registration := wire.RelayRegister{SchemaVersion: 1, Type: wire.Register, NodeID: "node_fixture01", PublicKey: public, Signature: base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, transcript))}
	if err = send(f.ctx, socket, registration); err != nil {
		f.t.Fatal(err)
	}
	var registered wire.RelayRegistered
	if err = f.read(socket, "RelayRegistered", &registered); err != nil {
		f.t.Fatal(err)
	}
	expected, _ := wire.RelayHostname(public, "nodes.relay.test")
	if registered.Hostname != expected || registered.SessionToken == "" {
		f.t.Fatal("wrong registered address")
	}
	return &fixtureNode{socket: socket, registered: registered, registration: registration, private: private}
}

func (f *fixture) publicOrigin(node *fixtureNode) string {
	_, port, _ := net.SplitHostPort(f.address)
	return "https://" + node.registered.Hostname + ":" + port
}

type byteRecorder struct {
	mu   sync.Mutex
	data []byte
}

func (r *byteRecorder) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.data) < 1024*1024 {
		r.data = append(r.data, p...)
	}
	return len(p), nil
}
func (r *byteRecorder) contains(p string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return bytes.Contains(r.data, []byte(p))
}

func (f *fixture) attachNode(node *fixtureNode, tlsTarget, httpTarget string) *byteRecorder {
	f.t.Helper()
	recorder := &byteRecorder{}
	finished := make(chan struct{})
	var workers sync.WaitGroup
	go func() {
		defer close(finished)
		defer workers.Wait()
		for {
			var open wire.RelayOpen
			if err := f.read(node.socket, "RelayOpen", &open); err != nil {
				return
			}
			data, err := f.dial("/v1/relay/stream", http.Header{"Authorization": []string{"Bearer " + node.registered.SessionToken}, "X-Convenewire-Relay-Stream": []string{open.StreamID}})
			if err != nil {
				return
			}
			upstream := tlsTarget
			if open.Kind == wire.Http01 {
				upstream = httpTarget
			}
			conn, err := net.DialTimeout("tcp", upstream, time.Second)
			if err != nil {
				data.CloseNow()
				return
			}
			workers.Add(1)
			go func() {
				defer workers.Done()
				defer data.CloseNow()
				defer conn.Close()
				tunnel := websocket.NetConn(f.ctx, data, websocket.MessageBinary)
				data.SetReadLimit(maximumFrameBytes)
				done := make(chan struct{}, 2)
				go func() {
					_, _ = io.CopyBuffer(conn, io.TeeReader(tunnel, recorder), make([]byte, 16*1024))
					done <- struct{}{}
				}()
				go func() {
					_, _ = io.CopyBuffer(tunnel, io.TeeReader(conn, recorder), make([]byte, 16*1024))
					done <- struct{}{}
				}()
				select {
				case <-done:
				case <-f.ctx.Done():
				}
				_ = data.CloseNow()
				_ = conn.Close()
			}()
		}
	}()
	f.t.Cleanup(func() {
		node.socket.CloseNow()
		select {
		case <-finished:
		case <-time.After(5 * time.Second):
			f.t.Error("fixture Node did not drain")
		}
	})
	return recorder
}

func waitFor(t *testing.T, predicate func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if predicate() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("state did not converge")
}

func TestTLSAndRuntimeWebSocketPassThroughUnchanged(t *testing.T) {
	f := newFixture(t, nil)
	upstream := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ws/peer/runtime" {
			conn, err := websocket.Accept(w, r, nil)
			if err != nil {
				return
			}
			defer conn.CloseNow()
			kind, body, err := conn.Read(r.Context())
			if err == nil {
				_ = conn.Write(r.Context(), kind, body)
			}
			return
		}
		if r.Header.Get("Authorization") != "Bearer business-token-must-stay-secret" {
			http.Error(w, "missing authorization", 401)
			return
		}
		w.Header().Set("X-Observed-Host", r.Host)
		_, _ = w.Write([]byte("private-room-output-must-stay-secret"))
	}))
	upstream.TLS = &tls.Config{Certificates: []tls.Certificate{f.cert}, MinVersion: tls.VersionTLS12}
	upstream.StartTLS()
	defer upstream.Close()
	node := f.register(nil)
	recorder := f.attachNode(node, upstream.Listener.Addr().String(), "")
	request, _ := http.NewRequestWithContext(f.ctx, http.MethodGet, f.publicOrigin(node)+"/api/peer/identity", nil)
	request.Header.Set("Authorization", "Bearer business-token-must-stay-secret")
	response, err := f.client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || string(body) != "private-room-output-must-stay-secret" || response.Header.Get("X-Observed-Host") != request.URL.Host {
		t.Fatal("TLS request changed")
	}
	ctx, cancel := context.WithTimeout(f.ctx, 3*time.Second)
	defer cancel()
	ws, reply, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(f.publicOrigin(node), "https")+"/ws/peer/runtime", &websocket.DialOptions{HTTPClient: f.client})
	if reply != nil && reply.Body != nil {
		reply.Body.Close()
	}
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	message := []byte("private-runtime-frame-must-stay-secret")
	if err = ws.Write(ctx, websocket.MessageText, message); err != nil {
		t.Fatal(err)
	}
	kind, received, err := ws.Read(ctx)
	if err != nil || kind != websocket.MessageText || !bytes.Equal(received, message) {
		t.Fatalf("WebSocket tunnel failed: %v", err)
	}
	for _, secret := range []string{"business-token-must-stay-secret", "private-room-output-must-stay-secret", string(message)} {
		if recorder.contains(secret) {
			t.Fatal("Relay stream contains business plaintext")
		}
	}
	if f.server.Stats().Nodes != 1 {
		t.Fatal("registration disappeared")
	}
}

func TestHTTP01ForwardsOnlyExactChallengeAndDropsResponseHeaders(t *testing.T) {
	f := newFixture(t, nil)
	node := f.register(nil)
	var seen atomicCounter
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen.increment()
		if r.URL.Path != "/.well-known/acme-challenge/fixture-token" || r.Host != node.registered.Hostname || r.Header.Get("X-Arbitrary") != "" || r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
			t.Error("unsafe challenge forwarding")
		}
		w.Header().Set("Set-Cookie", "unexpected=secret")
		w.Header().Set("Location", "https://foreign.example")
		_, _ = w.Write([]byte("fixture-token.account-thumbprint"))
	}))
	defer upstream.Close()
	f.attachNode(node, "", upstream.Listener.Addr().String())
	for _, tc := range []struct {
		method, path, host, header string
		want                       int
	}{
		{"GET", "/.well-known/acme-challenge/fixture-token", node.registered.Hostname, "X-Arbitrary", 200},
		{"GET", "/api/auth/session", node.registered.Hostname, "", 404},
		{"POST", "/.well-known/acme-challenge/fixture-token", node.registered.Hostname, "", 404},
		{"GET", "/.well-known/acme-challenge/fixture-token?target=x", node.registered.Hostname, "", 404},
		{"GET", "/.well-known/acme-challenge/fixture-token", node.registered.Hostname, "Cookie", 404},
		{"GET", "/.well-known/acme-challenge/fixture-token", node.registered.Hostname, "Authorization", 404},
		{"GET", "/.well-known/acme-challenge/fixture-token", "missing.nodes.relay.test", "", 503},
	} {
		request, _ := http.NewRequestWithContext(f.ctx, tc.method, "http://"+f.httpAddress+tc.path, nil)
		request.Host = tc.host
		if tc.header != "" {
			request.Header.Set(tc.header, "fixture-untrusted")
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != tc.want {
			t.Fatalf("%s %s got %d want %d", tc.method, tc.path, response.StatusCode, tc.want)
		}
		if response.Header.Get("Set-Cookie") != "" || response.Header.Get("Location") != "" {
			t.Fatal("untrusted response headers escaped")
		}
		if tc.want == 200 && string(body) != "fixture-token.account-thumbprint" {
			t.Fatal("challenge body changed")
		}
	}
	if seen.get() != 1 {
		t.Fatal("invalid challenge reached Node")
	}
}

type atomicCounter struct {
	mu sync.Mutex
	n  int
}

func (c *atomicCounter) increment() { c.mu.Lock(); c.n++; c.mu.Unlock() }
func (c *atomicCounter) get() int   { c.mu.Lock(); defer c.mu.Unlock(); return c.n }

func TestRegistrationReplayWrongServiceAndUnknownFieldsDenied(t *testing.T) {
	f := newFixture(t, nil)
	node := f.register(nil)
	node.socket.CloseNow()
	waitFor(t, func() bool { return f.server.Stats().Nodes == 0 })
	for _, mode := range []string{"replayed-signature", "wrong-origin", "unknown-field", "duplicate-field", "oversized"} {
		t.Run(mode, func(t *testing.T) {
			conn, err := f.dial("/v1/relay/control", nil)
			if err != nil {
				t.Fatal(err)
			}
			defer conn.CloseNow()
			var challenge wire.RelayChallenge
			if err = f.read(conn, "RelayChallenge", &challenge); err != nil {
				t.Fatal(err)
			}
			registration := node.registration
			if mode != "replayed-signature" {
				origin := f.origin
				if mode == "wrong-origin" {
					origin = "https://wrong.control.test"
				}
				transcript, _ := wire.RelayRegistrationTranscript(origin, "nodes.relay.test", challenge.Nonce, registration.NodeID, registration.PublicKey)
				registration.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(node.private, transcript))
			}
			raw, _ := json.Marshal(registration)
			if mode == "unknown-field" {
				raw = append(raw[:len(raw)-1], []byte(`,"scope":"admin"}`)...)
			}
			if mode == "duplicate-field" {
				raw = append(raw[:len(raw)-1], []byte(`,"nodeId":"node_other000"}`)...)
			}
			if mode == "oversized" {
				raw = []byte(strings.Repeat("x", maximumFrameBytes+1))
			}
			_ = conn.Write(f.ctx, websocket.MessageText, raw)
			var unexpected wire.RelayRegistered
			if f.read(conn, "RelayRegistered", &unexpected) == nil {
				t.Fatal("invalid registration accepted")
			}
		})
	}
	if f.server.Stats().Nodes != 0 {
		t.Fatal("bad registration created a route")
	}
}

func TestActiveRouteCannotBeReplacedAndDisconnectRevokesToken(t *testing.T) {
	f := newFixture(t, nil)
	node := f.register(nil)
	other, err := f.dial("/v1/relay/control", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer other.CloseNow()
	var challenge wire.RelayChallenge
	if err = f.read(other, "RelayChallenge", &challenge); err != nil {
		t.Fatal(err)
	}
	registration := node.registration
	transcript, _ := wire.RelayRegistrationTranscript(f.origin, "nodes.relay.test", challenge.Nonce, registration.NodeID, registration.PublicKey)
	registration.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(node.private, transcript))
	_ = send(f.ctx, other, registration)
	var rejected wire.RelayRegistered
	if f.read(other, "RelayRegistered", &rejected) == nil {
		t.Fatal("active route replaced")
	}
	node.socket.CloseNow()
	waitFor(t, func() bool { return f.server.Stats().Nodes == 0 })
	newNode := f.register(node.private)
	if newNode.registered.Hostname != node.registered.Hostname || newNode.registered.SessionToken == node.registered.SessionToken {
		t.Fatal("reconnect identity or token wrong")
	}
	public := f.rawPublic(newNode.registered.Hostname)
	defer public.Close()
	open := f.nextOpen(newNode)
	bad, err := f.dial("/v1/relay/stream", http.Header{"Authorization": []string{"Bearer " + node.registered.SessionToken}, "X-Convenewire-Relay-Stream": []string{open.StreamID}})
	if err == nil {
		bad.CloseNow()
		t.Fatal("old session token accepted")
	}
	attached := f.attach(newNode, open)
	attached.CloseNow()
}
