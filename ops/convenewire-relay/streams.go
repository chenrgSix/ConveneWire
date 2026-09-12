package relay

import (
	"bufio"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
	"github.com/coder/websocket"
)

var errUnavailable = errors.New("Relay route unavailable")
var streamPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
var challengePath = regexp.MustCompile(`^/\.well-known/acme-challenge/[A-Za-z0-9_-]{1,256}$`)

func (s *Server) openStream(hostname string, kind wire.RelayOpenKind, source net.Conn) (*stream, error) {
	id, err := secret()
	if err != nil {
		return nil, errUnavailable
	}
	s.mu.Lock()
	owner := s.routes[hostname]
	if s.closed || owner == nil || owner.ctx.Err() != nil || len(owner.streams) >= s.config.MaxStreamsPerNode {
		s.mu.Unlock()
		return nil, errUnavailable
	}
	stream := &stream{id: id, kind: kind, session: owner, source: source, attached: make(chan net.Conn, 1)}
	owner.streams[id] = stream
	s.mu.Unlock()
	if !s.worker(func() { stream.run() }) {
		stream.close()
		return nil, errUnavailable
	}
	if owner.send(wire.RelayOpen{SchemaVersion: 1, Type: wire.Open, StreamID: id, Kind: kind}) != nil {
		stream.close()
		return nil, errUnavailable
	}
	return stream, nil
}

func (s *Server) streamRequest(response http.ResponseWriter, request *http.Request) {
	authorization, id := singleHeader(request, "Authorization"), singleHeader(request, "X-Convenewire-Relay-Stream")
	if !strings.HasPrefix(authorization, "Bearer ") || !streamPattern.MatchString(strings.TrimPrefix(authorization, "Bearer ")) || !streamPattern.MatchString(id) {
		http.Error(response, "Relay stream denied", http.StatusForbidden)
		return
	}
	digest := sha256.Sum256([]byte(strings.TrimPrefix(authorization, "Bearer ")))
	s.mu.Lock()
	owner := s.tokens[digest]
	var candidate *stream
	if owner != nil {
		candidate = owner.streams[id]
	}
	if s.closed || owner == nil || owner.ctx.Err() != nil || candidate == nil || candidate.closed || candidate.claimed {
		s.mu.Unlock()
		http.Error(response, "Relay stream denied", http.StatusForbidden)
		return
	}
	// Consumption precedes the HTTP upgrade; a failed attempt cannot reuse it.
	candidate.claimed = true
	s.mu.Unlock()
	socket, err := websocket.Accept(response, request, &websocket.AcceptOptions{CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		candidate.close()
		return
	}
	data := websocket.NetConn(owner.ctx, socket, websocket.MessageBinary)
	// NetConn deliberately removes ReadLimit. Restore the protocol frame cap
	// before the first read; copy buffers keep outbound frames under this cap.
	socket.SetReadLimit(maximumFrameBytes)
	s.mu.Lock()
	if candidate.closed || s.closed || owner.ctx.Err() != nil {
		s.mu.Unlock()
		_ = socket.CloseNow()
		return
	}
	candidate.data = data
	candidate.socket = socket
	candidate.attached <- data
	s.mu.Unlock()
}

func (stream *stream) close() {
	s := stream.session.server
	s.mu.Lock()
	if stream.closed {
		s.mu.Unlock()
		return
	}
	stream.closed = true
	delete(stream.session.streams, stream.id)
	socket, source := stream.socket, stream.source
	s.mu.Unlock()
	_ = source.Close()
	if socket != nil {
		// A disabled/revoked stream cannot wait for an untrusted peer's close
		// handshake. Closing now unblocks both copy goroutines immediately.
		_ = socket.CloseNow()
	}
}

func (stream *stream) run() {
	defer stream.close()
	timer := time.NewTimer(stream.session.server.config.OpenTimeout)
	defer timer.Stop()
	var data net.Conn
	select {
	case data = <-stream.attached:
	case <-stream.session.ctx.Done():
		return
	case <-timer.C:
		return
	}
	var transferred atomic.Int64
	done := make(chan struct{}, 2)
	source := stream.source
	touch := func() {
		deadline := time.Now().Add(stream.session.server.config.IdleTimeout)
		_ = source.SetDeadline(deadline)
		_ = data.SetDeadline(deadline)
	}
	copyTo := func(destination, origin net.Conn) {
		defer func() { done <- struct{}{} }()
		buffer := make([]byte, 32*1024)
		for {
			count, err := origin.Read(buffer)
			if count > 0 {
				if transferred.Add(int64(count)) > stream.session.server.config.MaxStreamBytes {
					return
				}
				touch()
				if _, writeErr := writeFull(destination, buffer[:count]); writeErr != nil {
					return
				}
				touch()
			}
			if err != nil {
				return
			}
		}
	}
	touch()
	go copyTo(data, source)
	go func() {
		defer func() { done <- struct{}{} }()
		for {
			// Buffer at most one protocol frame. NetConn.Read streams partial
			// oversized messages before reporting its limit; Read instead rejects
			// the entire offending frame before any of those bytes are forwarded.
			kind, body, err := stream.socket.Read(stream.session.ctx)
			if err != nil || kind != websocket.MessageBinary || len(body) > maximumFrameBytes ||
				transferred.Add(int64(len(body))) > stream.session.server.config.MaxStreamBytes {
				return
			}
			touch()
			if _, err := writeFull(source, body); err != nil {
				return
			}
			touch()
		}
	}()
	completed := 0
	select {
	case <-done:
		completed++
	case <-stream.session.ctx.Done():
	}
	stream.close()
	// Both copy goroutines finish before the stream owner is released.
	for completed < 2 {
		<-done
		completed++
	}
}

func writeFull(writer io.Writer, data []byte) (int, error) {
	total := 0
	for len(data) > 0 {
		n, err := writer.Write(data)
		total += n
		data = data[n:]
		if err != nil {
			return total, err
		}
		if n == 0 {
			return total, io.ErrShortWrite
		}
	}
	return total, nil
}

func (s *Server) http01Request(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet || !validHostname(request.Host) || !challengePath.MatchString(request.RequestURI) ||
		request.ContentLength > 0 || len(request.TransferEncoding) > 0 || len(request.Header.Values("Authorization")) != 0 ||
		len(request.Header.Values("Cookie")) != 0 || len(request.Header.Values("Proxy-Authorization")) != 0 || len(request.Header.Values("Origin")) != 0 {
		http.Error(response, "ACME challenge unavailable", http.StatusNotFound)
		return
	}
	client, source := net.Pipe()
	defer client.Close()
	stream, err := s.openStream(request.Host, wire.Http01, source)
	if err != nil {
		_ = source.Close()
		http.Error(response, "ACME challenge unavailable", http.StatusServiceUnavailable)
		return
	}
	defer stream.close()
	stop := context.AfterFunc(request.Context(), func() { _ = client.Close() })
	defer stop()
	_ = client.SetDeadline(time.Now().Add(s.config.OpenTimeout + s.config.HandshakeTimeout))
	// Construct a fresh challenge-only request. User headers, cookies, query
	// parameters, authentication and arbitrary forwarding destinations never pass.
	if _, err = fmt.Fprintf(client, "GET %s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", request.RequestURI, request.Host); err != nil {
		http.Error(response, "ACME challenge unavailable", http.StatusServiceUnavailable)
		return
	}
	upstream, err := http.ReadResponse(bufio.NewReader(io.LimitReader(client, 16*1024)), request)
	if err != nil {
		http.Error(response, "ACME challenge unavailable", http.StatusServiceUnavailable)
		return
	}
	defer upstream.Body.Close()
	body, err := io.ReadAll(io.LimitReader(upstream.Body, 8193))
	if err != nil || len(body) > 8192 || upstream.StatusCode != http.StatusOK {
		http.Error(response, "ACME challenge unavailable", http.StatusNotFound)
		return
	}
	response.Header().Set("Content-Type", "text/plain; charset=utf-8")
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.WriteHeader(http.StatusOK)
	_, _ = response.Write(body)
}

// Stats is credential-free observability for local health checks and tests.
// No hostname, token, stream id, request bytes or Node identity is exposed.
type Stats struct {
	Connections int
	Nodes       int
	Streams     int
}

func (s *Server) Stats() Stats {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := Stats{Connections: len(s.connections), Nodes: len(s.routes)}
	for _, owner := range s.routes {
		result.Streams += len(owner.streams)
	}
	return result
}
