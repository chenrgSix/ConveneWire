package relay

import (
	"crypto/tls"
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"strings"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

const maximumFrameBytes = 64 * 1024

// Config contains operator-owned listener and resource policy, never a Node
// business credential. Zero limits select the documented conservative defaults.
type Config struct {
	RelayOrigin         string
	NodeDomain          string
	ControlTLS          *tls.Config
	MaxConnections      int
	MaxNodes            int
	MaxStreamsPerNode   int
	MaxStreamBytes      int64
	HandshakeTimeout    time.Duration
	RegistrationTimeout time.Duration
	OpenTimeout         time.Duration
	IdleTimeout         time.Duration
	PingInterval        time.Duration
	PingTimeout         time.Duration
}

func (c Config) normalized() (Config, error) {
	originJSON, _ := json.Marshal(c.RelayOrigin)
	domainJSON, _ := json.Marshal(c.NodeDomain)
	var decoded any
	if wire.Decode("RelayHTTPSOrigin", originJSON, &decoded) != nil || wire.Decode("RelayNodeDomain", domainJSON, &decoded) != nil {
		return c, errors.New("invalid Relay service configuration")
	}
	u, err := url.Parse(c.RelayOrigin)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" ||
		u.Fragment != "" || u.ForceQuery || u.String() != c.RelayOrigin || !validHostname(u.Hostname()) ||
		!validHostname(c.NodeDomain) || len(c.NodeDomain) > 211 || u.Hostname() == c.NodeDomain ||
		c.ControlTLS == nil ||
		(len(c.ControlTLS.Certificates) == 0 && c.ControlTLS.GetCertificate == nil && c.ControlTLS.GetConfigForClient == nil) {
		return c, errors.New("invalid Relay service configuration")
	}
	if c.MaxConnections == 0 {
		c.MaxConnections = 512
	}
	if c.MaxNodes == 0 {
		c.MaxNodes = 128
	}
	if c.MaxStreamsPerNode == 0 {
		c.MaxStreamsPerNode = 32
	}
	if c.MaxStreamBytes == 0 {
		c.MaxStreamBytes = 256 * 1024 * 1024
	}
	if c.HandshakeTimeout == 0 {
		c.HandshakeTimeout = 10 * time.Second
	}
	if c.RegistrationTimeout == 0 {
		c.RegistrationTimeout = 30 * time.Second
	}
	if c.OpenTimeout == 0 {
		c.OpenTimeout = 10 * time.Second
	}
	if c.IdleTimeout == 0 {
		c.IdleTimeout = 2 * time.Minute
	}
	if c.PingInterval == 0 {
		c.PingInterval = 20 * time.Second
	}
	if c.PingTimeout == 0 {
		c.PingTimeout = 10 * time.Second
	}
	if c.MaxConnections < 1 || c.MaxNodes < 1 || c.MaxStreamsPerNode < 1 || c.MaxStreamBytes < 1 ||
		c.HandshakeTimeout <= 0 || c.HandshakeTimeout > 10*time.Second || c.OpenTimeout <= 0 ||
		c.RegistrationTimeout < time.Millisecond || c.RegistrationTimeout > 30*time.Second ||
		c.IdleTimeout <= 0 || c.PingInterval <= 0 || c.PingTimeout <= 0 {
		return c, errors.New("invalid Relay resource limits")
	}
	c.ControlTLS = c.ControlTLS.Clone()
	if c.ControlTLS.MinVersion < tls.VersionTLS12 {
		c.ControlTLS.MinVersion = tls.VersionTLS12
	}
	// The control service only upgrades HTTP/1.1. Node ALPN remains untouched.
	c.ControlTLS.NextProtos = []string{"http/1.1"}
	return c, nil
}

func validHostname(host string) bool {
	if len(host) == 0 || len(host) > 253 || host != strings.ToLower(host) || !strings.Contains(host, ".") || net.ParseIP(host) != nil {
		return false
	}
	for _, label := range strings.Split(host, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, ch := range label {
			if (ch < 'a' || ch > 'z') && (ch < '0' || ch > '9') && ch != '-' {
				return false
			}
		}
	}
	return true
}
