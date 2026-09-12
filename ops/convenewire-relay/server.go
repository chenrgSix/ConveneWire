package relay

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"sync"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
	"github.com/coder/websocket"
)

var ErrClosed = errors.New("Relay is closed")

type Server struct {
	config           Config
	controlHost      string
	controlAuthority string
	ctx              context.Context
	cancel           context.CancelFunc
	mu               sync.Mutex
	closed           bool
	started          bool
	connections      map[net.Conn]struct{}
	routes           map[string]*session
	tokens           map[[32]byte]*session
	listeners        []net.Listener
	control          *http.Server
	challenge        *http.Server
	wg               sync.WaitGroup
	ready            chan struct{}
}

type session struct {
	server   *Server
	hostname string
	token    string
	socket   *websocket.Conn
	ctx      context.Context
	cancel   context.CancelFunc
	write    sync.Mutex
	streams  map[string]*stream
}

type stream struct {
	id       string
	kind     wire.RelayOpenKind
	session  *session
	source   net.Conn
	attached chan net.Conn
	data     net.Conn
	socket   *websocket.Conn
	claimed  bool
	closed   bool
}

// New constructs an inert Relay. Serve owns the supplied listener lifetimes;
// all Node traffic remains opaque through this process.
func New(config Config) (*Server, error) {
	config, err := config.normalized()
	if err != nil {
		return nil, err
	}
	u, _ := url.Parse(config.RelayOrigin)
	ctx, cancel := context.WithCancel(context.Background())
	s := &Server{config: config, controlHost: u.Hostname(), controlAuthority: u.Host, ctx: ctx, cancel: cancel,
		connections: make(map[net.Conn]struct{}), routes: make(map[string]*session), tokens: make(map[[32]byte]*session), ready: make(chan struct{})}
	s.control = &http.Server{Handler: http.HandlerFunc(s.controlRequest), ReadHeaderTimeout: config.HandshakeTimeout, ReadTimeout: config.HandshakeTimeout,
		IdleTimeout: config.IdleTimeout, MaxHeaderBytes: 16 * 1024}
	s.challenge = &http.Server{Handler: http.HandlerFunc(s.http01Request), ReadHeaderTimeout: config.HandshakeTimeout,
		ReadTimeout: config.HandshakeTimeout, WriteTimeout: config.OpenTimeout + config.HandshakeTimeout, IdleTimeout: config.HandshakeTimeout, MaxHeaderBytes: 8 * 1024}
	return s, nil
}

// Serve accepts public TLS and HTTP-01 connections. Production listeners are
// TCP :443 and :80; injected listeners support unprivileged deterministic tests.
func (s *Server) Serve(publicTLS, publicHTTP net.Listener) error {
	if publicTLS == nil || publicHTTP == nil {
		return errors.New("both Relay listeners are required")
	}
	s.mu.Lock()
	if s.started || s.closed {
		s.mu.Unlock()
		return ErrClosed
	}
	s.started = true
	control := newConnectionListener(publicTLS.Addr())
	s.listeners = []net.Listener{publicTLS, publicHTTP, control}
	s.mu.Unlock()
	errorsOut := make(chan error, 3)
	go func() { errorsOut <- s.control.Serve(tls.NewListener(control, s.config.ControlTLS)) }()
	go func() { errorsOut <- s.challenge.Serve(&limitedListener{Listener: publicHTTP, server: s}) }()
	go func() { errorsOut <- s.acceptTLS(publicTLS, control) }()
	close(s.ready)
	err := <-errorsOut
	_ = s.Close()
	<-errorsOut
	<-errorsOut
	s.wg.Wait()
	if errors.Is(err, net.ErrClosed) || errors.Is(err, http.ErrServerClosed) || errors.Is(err, ErrClosed) {
		return nil
	}
	return errors.New("Relay listener stopped")
}

// Ready closes once Serve has installed all listener owners. It contains no
// remote health or certificate-provisioning assertion.
func (s *Server) Ready() <-chan struct{} { return s.ready }

func (s *Server) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	s.cancel()
	listeners := append([]net.Listener(nil), s.listeners...)
	connections := make([]net.Conn, 0, len(s.connections))
	for conn := range s.connections {
		connections = append(connections, conn)
	}
	s.mu.Unlock()
	for _, listener := range listeners {
		_ = listener.Close()
	}
	_ = s.control.Close()
	_ = s.challenge.Close()
	for _, conn := range connections {
		_ = conn.Close()
	}
	return nil
}

func (s *Server) tracked(conn net.Conn) net.Conn {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || len(s.connections) >= s.config.MaxConnections {
		_ = conn.Close()
		return nil
	}
	s.connections[conn] = struct{}{}
	return &trackedConn{Conn: conn, release: func() { s.mu.Lock(); delete(s.connections, conn); s.mu.Unlock() }}
}

func (s *Server) worker(work func()) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return false
	}
	s.wg.Add(1)
	go func() { defer s.wg.Done(); work() }()
	return true
}

func (s *Server) acceptTLS(listener net.Listener, control *connectionListener) error {
	for {
		conn, err := listener.Accept()
		if err != nil {
			return err
		}
		conn = s.tracked(conn)
		if conn == nil {
			continue
		}
		if !s.worker(func() {
			keep := false
			defer func() {
				if !keep {
					_ = conn.Close()
				}
			}()
			_ = conn.SetReadDeadline(time.Now().Add(s.config.HandshakeTimeout))
			host, prefix, err := readServerName(conn, maximumFrameBytes)
			if err != nil {
				return
			}
			_ = conn.SetReadDeadline(time.Time{})
			forward := &prefixedConn{Conn: conn, prefix: bytes.NewReader(prefix)}
			if host == s.controlHost {
				keep = control.deliver(forward, s.ctx)
				return
			}
			if _, err := s.openStream(host, wire.TLS, forward); err != nil {
				return
			}
			keep = true
		}) {
			_ = conn.Close()
		}
	}
}

func singleHeader(request *http.Request, name string) string {
	values := request.Header.Values(name)
	if len(values) != 1 {
		return ""
	}
	return values[0]
}

func (s *Server) controlRequest(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet || request.Host != s.controlAuthority || request.URL.RawQuery != "" || request.URL.ForceQuery ||
		request.URL.EscapedPath() != request.URL.Path || request.ContentLength != 0 || len(request.TransferEncoding) != 0 || len(request.Header.Values("Origin")) != 0 || len(request.Header.Values("Cookie")) != 0 ||
		len(request.Header.Values("Proxy-Authorization")) != 0 || (request.URL.Path != "/v1/relay/control" && request.URL.Path != "/v1/relay/stream" && request.URL.Path != "/healthz") {
		http.Error(response, "Relay endpoint denied", http.StatusForbidden)
		return
	}
	if request.URL.Path == "/v1/relay/stream" {
		s.streamRequest(response, request)
		return
	}
	if len(request.Header.Values("Authorization")) != 0 || len(request.Header.Values("X-Convenewire-Relay-Stream")) != 0 {
		http.Error(response, "Relay endpoint denied", http.StatusForbidden)
		return
	}
	if request.URL.Path == "/healthz" {
		s.mu.Lock()
		ready := s.started && !s.closed
		s.mu.Unlock()
		if !ready {
			http.Error(response, "Relay unavailable", http.StatusServiceUnavailable)
			return
		}
		response.Header().Set("Content-Type", "text/plain; charset=utf-8")
		response.Header().Set("Cache-Control", "no-store")
		_, _ = io.WriteString(response, "ready\n")
		return
	}
	s.mu.Lock()
	available := !s.closed && len(s.routes) < s.config.MaxNodes
	s.mu.Unlock()
	if !available {
		http.Error(response, "Relay unavailable", http.StatusServiceUnavailable)
		return
	}
	socket, err := websocket.Accept(response, request, &websocket.AcceptOptions{CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		return
	}
	socket.SetReadLimit(maximumFrameBytes)
	if !s.worker(func() { s.controlSession(socket) }) {
		_ = socket.CloseNow()
	}
}

func secret() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

func send(ctx context.Context, socket *websocket.Conn, value any) error {
	raw, err := json.Marshal(value)
	if err != nil || len(raw) > maximumFrameBytes {
		return errors.New("Relay frame invalid")
	}
	return socket.Write(ctx, websocket.MessageText, raw)
}

func (s *Server) controlSession(socket *websocket.Conn) {
	defer socket.CloseNow()
	expires := time.Now().Add(s.config.RegistrationTimeout).Truncate(time.Millisecond)
	ctx, cancel := context.WithDeadline(s.ctx, expires)
	defer cancel()
	nonce, err := secret()
	if err != nil {
		return
	}
	if send(ctx, socket, wire.RelayChallenge{SchemaVersion: 1, Type: wire.Challenge, Nonce: nonce, ExpiresAt: expires.UTC().Format("2006-01-02T15:04:05.000Z"), RelayOrigin: s.config.RelayOrigin, NodeDomain: s.config.NodeDomain}) != nil {
		return
	}
	kind, raw, err := socket.Read(ctx)
	var registration wire.RelayRegister
	if err != nil || kind != websocket.MessageText || !time.Now().Before(expires) || wire.Decode("RelayRegister", raw, &registration) != nil {
		return
	}
	transcript, err := wire.RelayRegistrationTranscript(s.config.RelayOrigin, s.config.NodeDomain, nonce, registration.NodeID, registration.PublicKey)
	if err != nil {
		return
	}
	publicKey, keyErr := base64.RawURLEncoding.DecodeString(registration.PublicKey)
	signature, sigErr := base64.RawURLEncoding.DecodeString(registration.Signature)
	if keyErr != nil || sigErr != nil || len(publicKey) != ed25519.PublicKeySize || !ed25519.Verify(publicKey, transcript, signature) {
		return
	}
	hostname, err := wire.RelayHostname(registration.PublicKey, s.config.NodeDomain)
	if err != nil || hostname == s.controlHost {
		return
	}
	token, err := secret()
	if err != nil {
		return
	}
	live, stop := context.WithCancel(s.ctx)
	defer stop()
	connection := &session{server: s, hostname: hostname, token: token, socket: socket, ctx: live, cancel: stop, streams: make(map[string]*stream)}
	// Public traffic may arrive as soon as the route exists. Reserve the first
	// control write before publication so "registered" always precedes "open".
	connection.write.Lock()
	s.mu.Lock()
	if s.closed || s.routes[hostname] != nil || len(s.routes) >= s.config.MaxNodes {
		s.mu.Unlock()
		connection.write.Unlock()
		return
	}
	s.routes[hostname] = connection
	s.tokens[sha256.Sum256([]byte(token))] = connection
	s.mu.Unlock()
	defer connection.close()
	firstWrite, firstCancel := context.WithTimeout(live, s.config.OpenTimeout)
	err = send(firstWrite, socket, wire.RelayRegistered{SchemaVersion: 1, Type: wire.Registered, Hostname: hostname, SessionToken: token})
	firstCancel()
	connection.write.Unlock()
	if err != nil {
		return
	}
	// One registration per control connection. The reader services ping/pong;
	// any further application message is a protocol error.
	readDone := make(chan struct{})
	go func() { defer close(readDone); _, _, _ = socket.Read(live); stop() }()
	defer func() { stop(); _ = socket.CloseNow(); <-readDone }()
	ticker := time.NewTicker(s.config.PingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-live.Done():
			return
		case <-ticker.C:
			ping, pingCancel := context.WithTimeout(live, s.config.PingTimeout)
			err := socket.Ping(ping)
			pingCancel()
			if err != nil {
				return
			}
		}
	}
}

func (c *session) send(value any) error {
	c.write.Lock()
	defer c.write.Unlock()
	ctx, cancel := context.WithTimeout(c.ctx, c.server.config.OpenTimeout)
	defer cancel()
	return send(ctx, c.socket, value)
}

func (c *session) close() {
	c.cancel()
	s := c.server
	s.mu.Lock()
	if s.routes[c.hostname] == c {
		delete(s.routes, c.hostname)
	}
	delete(s.tokens, sha256.Sum256([]byte(c.token)))
	streams := make([]*stream, 0, len(c.streams))
	for _, stream := range c.streams {
		streams = append(streams, stream)
	}
	s.mu.Unlock()
	for _, stream := range streams {
		stream.close()
	}
}

type trackedConn struct {
	net.Conn
	once    sync.Once
	release func()
}

func (c *trackedConn) Close() error { err := c.Conn.Close(); c.once.Do(c.release); return err }

type limitedListener struct {
	net.Listener
	server *Server
}

func (l *limitedListener) Accept() (net.Conn, error) {
	for {
		conn, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}
		if conn = l.server.tracked(conn); conn != nil {
			return conn, nil
		}
	}
}

type connectionListener struct {
	address     net.Addr
	connections chan net.Conn
	done        chan struct{}
	once        sync.Once
}

func newConnectionListener(address net.Addr) *connectionListener {
	return &connectionListener{address: address, connections: make(chan net.Conn), done: make(chan struct{})}
}
func (l *connectionListener) Accept() (net.Conn, error) {
	select {
	case conn := <-l.connections:
		return conn, nil
	case <-l.done:
		return nil, net.ErrClosed
	}
}
func (l *connectionListener) Close() error   { l.once.Do(func() { close(l.done) }); return nil }
func (l *connectionListener) Addr() net.Addr { return l.address }
func (l *connectionListener) deliver(conn net.Conn, ctx context.Context) bool {
	select {
	case l.connections <- conn:
		return true
	case <-l.done:
		return false
	case <-ctx.Done():
		return false
	}
}

var _ io.ReadWriteCloser = (*prefixedConn)(nil)
