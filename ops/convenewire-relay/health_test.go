package relay

import (
	"context"
	"crypto/x509"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
)

func TestHealthCheckVerifiesControlTLSAndBothLocalListeners(t *testing.T) {
	f := newFixture(t, nil)
	config := HealthConfig{RelayOrigin: f.origin, TLSAddress: f.address, HTTPAddress: f.httpAddress, RootCAs: f.roots}
	if err := CheckHealth(context.Background(), config); err != nil {
		t.Fatal(err)
	}
	if stats := f.server.Stats(); stats.Nodes != 0 || stats.Streams != 0 {
		t.Fatal("health probe created a Node registration or stream")
	}
	for name, mutate := range map[string]func(*HealthConfig){
		"untrusted certificate": func(c *HealthConfig) { c.RootCAs = x509.NewCertPool() },
		"wrong control host": func(c *HealthConfig) {
			c.RelayOrigin = strings.Replace(c.RelayOrigin, "relay.control.test", "other.control.test", 1)
		},
		"public dial rejected": func(c *HealthConfig) { c.TLSAddress = "192.0.2.1:8443" },
		"DNS dial rejected":    func(c *HealthConfig) { c.TLSAddress = "localhost:8443" },
		"redirecting origin":   func(c *HealthConfig) { c.RelayOrigin += "/redirect" },
		"wrong HTTP listener":  func(c *HealthConfig) { c.HTTPAddress = c.TLSAddress },
	} {
		t.Run(name, func(t *testing.T) {
			changed := config
			mutate(&changed)
			if err := CheckHealth(context.Background(), changed); err == nil {
				t.Fatal("unhealthy or unsafe configuration passed")
			}
		})
	}
	dead, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	config.HTTPAddress = dead.Addr().String()
	dead.Close()
	if err = CheckHealth(context.Background(), config); err == nil {
		t.Fatal("failed HTTP-01 listener passed readiness")
	}
}

func TestHealthEndpointRejectsCredentialsAndAmbiguousRequests(t *testing.T) {
	f := newFixture(t, nil)
	for _, item := range []struct {
		name, method, path, header, value string
	}{
		{"cookie", "GET", "/healthz", "Cookie", "owner=secret"},
		{"authorization", "GET", "/healthz", "Authorization", "Bearer secret"},
		{"stream token", "GET", "/healthz", "X-Convenewire-Relay-Stream", "secret"},
		{"browser origin", "GET", "/healthz", "Origin", "https://other.test"},
		{"query", "GET", "/healthz?token=secret", "", ""},
		{"encoded path", "GET", "/%68ealthz", "", ""},
		{"method", "POST", "/healthz", "", ""},
		{"wrong host", "GET", "/healthz", "Host", "other.test"},
	} {
		t.Run(item.name, func(t *testing.T) {
			request, _ := http.NewRequest(item.method, f.origin+item.path, nil)
			if item.header == "Host" {
				request.Host = item.value
			} else if item.header != "" {
				request.Header.Set(item.header, item.value)
			}
			response, err := f.client.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, _ := io.ReadAll(response.Body)
			if response.StatusCode != http.StatusForbidden || strings.Contains(string(body), "secret") {
				t.Fatal("health endpoint admitted malformed request or disclosed input")
			}
		})
	}
}
