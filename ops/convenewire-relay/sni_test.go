package relay

import (
	"bytes"
	"encoding/binary"
	"io"
	"net"
	"testing"
	"time"
)

func helloBytes(host string) []byte {
	name := append([]byte{0, byte((len(host) + 3) >> 8), byte(len(host) + 3), 0, byte(len(host) >> 8), byte(len(host))}, []byte(host)...)
	// The extension vector uses a two-byte server_name extension type followed
	// by the full ServerNameList. Its first byte is supplied above.
	name = name[1:]
	ext := append([]byte{0, 0, byte(len(name) >> 8), byte(len(name))}, name...)
	hello := append([]byte{3, 3}, make([]byte, 32)...)
	hello = append(hello, 0, 0, 2, 0x13, 1, 1, 0, byte(len(ext)>>8), byte(len(ext)))
	hello = append(hello, ext...)
	handshake := append([]byte{1, byte(len(hello) >> 16), byte(len(hello) >> 8), byte(len(hello))}, hello...)
	return append([]byte{22, 3, 1, byte(len(handshake) >> 8), byte(len(handshake))}, handshake...)
}

func parseBytes(t *testing.T, raw []byte, maximum int) (string, []byte, error) {
	t.Helper()
	reader, writer := net.Pipe()
	defer reader.Close()
	reader.SetDeadline(time.Now().Add(time.Second))
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer writer.Close()
		for len(raw) > 0 {
			size := 3
			if len(raw) < size {
				size = len(raw)
			}
			if _, err := writer.Write(raw[:size]); err != nil {
				return
			}
			raw = raw[size:]
		}
	}()
	host, replayed, err := readServerName(reader, maximum)
	reader.Close()
	<-done
	return host, replayed, err
}

func TestClientHelloAcrossTCPAndTLSRecordsRetainsEveryByte(t *testing.T) {
	raw := helloBytes("n1234567890123456789012345678901234567890.nodes.relay.test")
	for _, split := range []int{1, 3, 17, len(raw) - 7} {
		body := raw[5:]
		fragmented := append([]byte{22, 3, 1, byte(split >> 8), byte(split)}, body[:split]...)
		last := append(append([]byte(nil), body[split:]...), []byte{99, 98, 97}...)
		fragmented = append(fragmented, 22, 3, 3, byte(len(last)>>8), byte(len(last)))
		fragmented = append(fragmented, last...)
		host, replayed, err := parseBytes(t, fragmented, maximumFrameBytes)
		if err != nil || host != "n1234567890123456789012345678901234567890.nodes.relay.test" || !bytes.Equal(fragmented, replayed) {
			t.Fatalf("split %d failed: %v", split, err)
		}
	}
}

func TestMalformedAndUnboundedClientHelloFailsClosed(t *testing.T) {
	valid := helloBytes("node.example.test")
	for _, tc := range []struct {
		name    string
		raw     []byte
		maximum int
	}{
		{"bad-type", append([]byte{23}, valid[1:]...), maximumFrameBytes},
		{"oversized-record", []byte{22, 3, 3, 255, 255}, maximumFrameBytes},
		{"incomplete-header", []byte{22, 3}, maximumFrameBytes},
		{"limit", valid, len(valid) - 1},
		{"uppercase", helloBytes("NODE.example.test"), maximumFrameBytes},
		{"foreign-url", helloBytes("https://node.example.test"), maximumFrameBytes},
		{"ip", helloBytes("127.0.0.1"), maximumFrameBytes},
		{"trailing-dot", helloBytes("node.example.test."), maximumFrameBytes},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := parseBytes(t, tc.raw, tc.maximum); err == nil {
				t.Fatal("invalid hello accepted")
			}
		})
	}
	length := binary.BigEndian.Uint16(valid[3:])
	if int(length) != len(valid)-5 {
		t.Fatal("invalid test hello")
	}
}

func TestPrefixedConnectionReturnsRemainderExactlyOnce(t *testing.T) {
	reader, writer := net.Pipe()
	defer reader.Close()
	go func() { defer writer.Close(); writer.Write([]byte("tail")) }()
	conn := &prefixedConn{Conn: reader, prefix: bytes.NewReader([]byte("prefix"))}
	got, err := io.ReadAll(conn)
	if err != nil || string(got) != "prefixtail" {
		t.Fatal("prefix replay changed bytes")
	}
}
