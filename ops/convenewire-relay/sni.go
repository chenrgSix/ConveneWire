package relay

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"net"
)

var errClientHello = errors.New("invalid TLS ClientHello")

// readServerName only inspects a bounded initial ClientHello. Its return value
// contains every byte read, including bytes after the handshake in its last
// record. Callers must replay all of it and never perform a local TLS handshake.
func readServerName(conn net.Conn, maximum int) (string, []byte, error) {
	var original, handshake []byte
	for {
		if len(original)+5 > maximum {
			return "", nil, errClientHello
		}
		header := make([]byte, 5)
		if _, err := io.ReadFull(conn, header); err != nil {
			return "", nil, errClientHello
		}
		size := int(binary.BigEndian.Uint16(header[3:]))
		if header[0] != 22 || header[1] != 3 || header[2] > 3 || size == 0 || size > 16384 || len(original)+5+size > maximum {
			return "", nil, errClientHello
		}
		record := make([]byte, size)
		if _, err := io.ReadFull(conn, record); err != nil {
			return "", nil, errClientHello
		}
		original = append(original, header...)
		original = append(original, record...)
		handshake = append(handshake, record...)
		if len(handshake) < 4 {
			continue
		}
		size = int(handshake[1])<<16 | int(handshake[2])<<8 | int(handshake[3])
		if handshake[0] != 1 || size < 38 || size+4 > maximum {
			return "", nil, errClientHello
		}
		if len(handshake) < size+4 {
			continue
		}
		host, err := clientHelloServerName(handshake[4 : 4+size])
		return host, original, err
	}
}

func clientHelloServerName(hello []byte) (string, error) {
	// legacy_version, random, session id, cipher suites and compression methods.
	if len(hello) < 35 || hello[0] != 3 {
		return "", errClientHello
	}
	p := 34
	advance := func(size int) bool {
		if size < 0 || p+size > len(hello) {
			return false
		}
		p += size
		return true
	}
	sessionSize := int(hello[p])
	if sessionSize > 32 || !advance(1+sessionSize) || p+2 > len(hello) {
		return "", errClientHello
	}
	cipherSize := int(binary.BigEndian.Uint16(hello[p:]))
	if cipherSize == 0 || cipherSize%2 != 0 || !advance(2+cipherSize) || p >= len(hello) {
		return "", errClientHello
	}
	compressionSize := int(hello[p])
	if compressionSize == 0 || !advance(1+compressionSize) || p+2 > len(hello) {
		return "", errClientHello
	}
	extensionsSize := int(binary.BigEndian.Uint16(hello[p:]))
	p += 2
	if p+extensionsSize != len(hello) {
		return "", errClientHello
	}
	seen := make(map[uint16]bool)
	var hostname string
	for p < len(hello) {
		if p+4 > len(hello) {
			return "", errClientHello
		}
		kind, size := binary.BigEndian.Uint16(hello[p:]), int(binary.BigEndian.Uint16(hello[p+2:]))
		p += 4
		if seen[kind] || p+size > len(hello) {
			return "", errClientHello
		}
		seen[kind] = true
		if kind == 0 {
			extension := hello[p : p+size]
			if len(extension) < 5 || int(binary.BigEndian.Uint16(extension)) != len(extension)-2 || extension[2] != 0 ||
				int(binary.BigEndian.Uint16(extension[3:])) != len(extension)-5 {
				return "", errClientHello
			}
			hostname = string(extension[5:])
			if !validHostname(hostname) {
				return "", errClientHello
			}
		}
		p += size
	}
	if hostname == "" {
		return "", errClientHello
	}
	return hostname, nil
}

type prefixedConn struct {
	net.Conn
	prefix *bytes.Reader
}

func (c *prefixedConn) Read(p []byte) (int, error) {
	if c.prefix.Len() > 0 {
		return c.prefix.Read(p)
	}
	return c.Conn.Read(p)
}
