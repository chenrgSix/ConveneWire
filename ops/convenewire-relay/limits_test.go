package relay

import (
	"context"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
	"github.com/coder/websocket"
)

func (f *fixture) rawPublic(host string) net.Conn {
	f.t.Helper()
	conn, err := net.DialTimeout("tcp", f.address, time.Second)
	if err != nil {
		f.t.Fatal(err)
	}
	f.t.Cleanup(func() { conn.Close() })
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err = conn.Write(helloBytes(host)); err != nil {
		f.t.Fatal(err)
	}
	return conn
}

func (f *fixture) nextOpen(node *fixtureNode) wire.RelayOpen {
	f.t.Helper()
	var open wire.RelayOpen
	if err := f.read(node.socket, "RelayOpen", &open); err != nil {
		f.t.Fatal(err)
	}
	return open
}

func (f *fixture) attach(node *fixtureNode, open wire.RelayOpen) *websocket.Conn {
	f.t.Helper()
	conn, err := f.dial("/v1/relay/stream", http.Header{"Authorization": []string{"Bearer " + node.registered.SessionToken}, "X-Convenewire-Relay-Stream": []string{open.StreamID}})
	if err != nil {
		f.t.Fatal(err)
	}
	f.t.Cleanup(func() { conn.CloseNow() })
	return conn
}

func TestPendingStreamLimitTimeoutAndWrongRoute(t *testing.T) {
	f := newFixture(t, func(c *Config) { c.MaxStreamsPerNode = 1; c.OpenTimeout = 300 * time.Millisecond })
	node := f.register(nil)
	first := f.rawPublic(node.registered.Hostname)
	_ = f.nextOpen(node)
	second := f.rawPublic(node.registered.Hostname)
	if _, err := second.Read(make([]byte, 1)); err == nil {
		t.Fatal("second stream exceeded limit")
	}
	if f.server.Stats().Streams != 1 {
		t.Fatal("pending stream not counted")
	}
	if _, err := first.Read(make([]byte, 1)); err == nil {
		t.Fatal("unattached stream did not expire")
	}
	waitFor(t, func() bool { return f.server.Stats().Streams == 0 })
	unknown := f.rawPublic("n0000000000000000000000000000000000000000.nodes.relay.test")
	if _, err := unknown.Read(make([]byte, 1)); err == nil {
		t.Fatal("unknown SNI routed")
	}
}

func TestStreamEpochCannotAttachWrongNodeOrReplay(t *testing.T) {
	f := newFixture(t, nil)
	node := f.register(nil)
	other := f.register(nil)
	public := f.rawPublic(node.registered.Hostname)
	open := f.nextOpen(node)
	wrong, err := f.dial("/v1/relay/stream", http.Header{"Authorization": []string{"Bearer " + other.registered.SessionToken}, "X-Convenewire-Relay-Stream": []string{open.StreamID}})
	if err == nil {
		wrong.CloseNow()
		t.Fatal("other Node attached stream")
	}
	attached := f.attach(node, open)
	duplicate, err := f.dial("/v1/relay/stream", http.Header{"Authorization": []string{"Bearer " + node.registered.SessionToken}, "X-Convenewire-Relay-Stream": []string{open.StreamID}})
	if err == nil {
		duplicate.CloseNow()
		t.Fatal("stream attached twice")
	}
	ctx, cancel := context.WithTimeout(f.ctx, time.Second)
	defer cancel()
	kind, raw, err := attached.Read(ctx)
	if err != nil || kind != websocket.MessageBinary || len(raw) == 0 || raw[0] != 22 {
		t.Fatalf("TLS prefix was not replayed: %v", err)
	}
	node.socket.CloseNow()
	if _, err = public.Read(make([]byte, 1)); err == nil {
		t.Fatal("public stream survived registration disconnect")
	}
	waitFor(t, func() bool { return f.server.Stats().Streams == 0 })
}

func TestOversizedBinaryFrameAndTransferQuotaCloseStream(t *testing.T) {
	for _, mode := range []string{"frame", "quota", "idle"} {
		t.Run(mode, func(t *testing.T) {
			f := newFixture(t, func(c *Config) {
				if mode == "quota" {
					c.MaxStreamBytes = 2048
				}
				if mode == "idle" {
					c.IdleTimeout = 120 * time.Millisecond
				}
			})
			node := f.register(nil)
			public := f.rawPublic(node.registered.Hostname)
			data := f.attach(node, f.nextOpen(node))
			ctx, cancel := context.WithTimeout(f.ctx, 2*time.Second)
			defer cancel()
			_, _, err := data.Read(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if mode == "frame" {
				_ = data.Write(ctx, websocket.MessageBinary, make([]byte, maximumFrameBytes+1))
			}
			if mode == "quota" {
				_ = data.Write(ctx, websocket.MessageBinary, make([]byte, 4096))
			}
			forwarded, err := io.ReadAll(public)
			if err != nil || len(forwarded) != 0 {
				t.Fatalf("stream did not close within its limit: bytes=%d error=%v", len(forwarded), err)
			}
			waitFor(t, func() bool { return f.server.Stats().Streams == 0 })
		})
	}
}

func TestConnectionLimitAndShutdownDrainOpenSockets(t *testing.T) {
	f := newFixture(t, func(c *Config) { c.MaxConnections = 2 })
	node := f.register(nil)
	public := f.rawPublic(node.registered.Hostname)
	_ = f.nextOpen(node)
	extra, err := net.DialTimeout("tcp", f.address, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer extra.Close()
	extra.SetReadDeadline(time.Now().Add(time.Second))
	if _, err = extra.Read(make([]byte, 1)); err == nil {
		t.Fatal("connection limit did not close excess")
	}
	if f.server.Stats().Connections > 2 {
		t.Fatal("connection limit exceeded")
	}
	if err = f.server.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err = public.Read(make([]byte, 1)); err == nil {
		t.Fatal("shutdown left public stream open")
	}
	waitFor(t, func() bool {
		stats := f.server.Stats()
		return stats.Nodes == 0 && stats.Streams == 0 && stats.Connections == 0
	})
}

func TestControlRejectsCookieOriginQueryAndDuplicateAuth(t *testing.T) {
	f := newFixture(t, nil)
	for _, tc := range []struct {
		path    string
		headers http.Header
	}{
		{"/v1/relay/control?secret=x", nil},
		{"/v1/relay/control", http.Header{"Cookie": []string{"business=secret"}}},
		{"/v1/relay/control", http.Header{"Origin": []string{"https://foreign.example"}}},
		{"/v1/relay/control", http.Header{"Authorization": []string{"Bearer business"}}},
		{"/v1/relay/stream", http.Header{"Authorization": []string{"Bearer one", "Bearer two"}}},
	} {
		conn, err := f.dial(tc.path, tc.headers)
		if err == nil {
			conn.CloseNow()
			t.Fatal("invalid control request accepted")
		}
	}
}

func TestUnexpectedControlMessageInvalidatesSession(t *testing.T) {
	f := newFixture(t, nil)
	node := f.register(nil)
	_ = send(f.ctx, node.socket, node.registration)
	waitFor(t, func() bool { return f.server.Stats().Nodes == 0 })
	ctx, cancel := context.WithTimeout(f.ctx, time.Second)
	defer cancel()
	if _, _, err := node.socket.Read(ctx); err == nil || err == io.EOF {
		t.Fatal("extra registration did not close WebSocket")
	}
}

func TestRegistrationExpiryAndPingDeadlineReleaseRoutes(t *testing.T) {
	t.Run("challenge-expires", func(t *testing.T) {
		f := newFixture(t, func(c *Config) { c.RegistrationTimeout = 50 * time.Millisecond })
		conn, err := f.dial("/v1/relay/control", nil)
		if err != nil {
			t.Fatal(err)
		}
		defer conn.CloseNow()
		var challenge wire.RelayChallenge
		if err = f.read(conn, "RelayChallenge", &challenge); err != nil {
			t.Fatal(err)
		}
		expires, err := time.Parse(time.RFC3339Nano, challenge.ExpiresAt)
		if err != nil || time.Until(expires) > 50*time.Millisecond {
			t.Fatal("challenge expiry is not bounded")
		}
		ctx, cancel := context.WithTimeout(f.ctx, time.Second)
		defer cancel()
		if _, _, err = conn.Read(ctx); err == nil {
			t.Fatal("unregistered connection survived challenge expiry")
		}
		if f.server.Stats().Nodes != 0 {
			t.Fatal("expired challenge registered a Node")
		}
	})
	t.Run("ping-expires", func(t *testing.T) {
		f := newFixture(t, func(c *Config) { c.PingInterval = 20 * time.Millisecond; c.PingTimeout = 30 * time.Millisecond })
		node := f.register(nil)
		_ = node
		// Deliberately do not read the control socket, so it cannot answer ping.
		waitFor(t, func() bool { return f.server.Stats().Nodes == 0 })
	})
}

func TestBackpressureClosesBlockedDestinationWithoutUnboundedBuffering(t *testing.T) {
	f := newFixture(t, func(c *Config) { c.IdleTimeout = 150 * time.Millisecond; c.PingInterval = 10 * time.Second })
	node := f.register(nil)
	public := f.rawPublic(node.registered.Hostname)
	data := f.attach(node, f.nextOpen(node))
	ctx, cancel := context.WithTimeout(f.ctx, time.Second)
	defer cancel()
	if _, _, err := data.Read(ctx); err != nil {
		t.Fatal(err)
	}
	// The simulated Node stops consuming. A bounded copy blocks on transport
	// capacity and its idle deadline; it cannot queue this entire 32 MiB burst.
	public.SetWriteDeadline(time.Now().Add(2 * time.Second))
	buffer := make([]byte, 32*1024)
	written := 0
	for written < 32*1024*1024 {
		n, err := public.Write(buffer)
		written += n
		if err != nil {
			break
		}
	}
	if written >= 32*1024*1024 {
		t.Fatal("blocked stream consumed an unbounded producer burst")
	}
	waitFor(t, func() bool { return f.server.Stats().Streams == 0 })
}

func TestNodeLimitPreservesExistingRegistration(t *testing.T) {
	f := newFixture(t, func(c *Config) { c.MaxNodes = 1 })
	_ = f.register(nil)
	conn, err := f.dial("/v1/relay/control", nil)
	if err == nil {
		conn.CloseNow()
		t.Fatal("Node limit exceeded")
	}
	if f.server.Stats().Nodes != 1 {
		t.Fatal("Node limit removed existing registration")
	}
}
