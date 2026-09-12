package relay

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

// HealthConfig checks both local listener paths without registering a Node or
// relying on public DNS. Normal control hostname and certificate checks apply.
type HealthConfig struct {
	RelayOrigin string
	TLSAddress  string
	HTTPAddress string
	RootCAs     *x509.CertPool
}

// CheckHealth is a bounded local readiness probe. It does not assert that public
// DNS, a Node, a CA or the operator's firewall is healthy. It never follows a
// redirect, uses an environment proxy, sends credentials or disables TLS checks.
func CheckHealth(ctx context.Context, config HealthConfig) error {
	raw, _ := json.Marshal(config.RelayOrigin)
	var origin string
	if wire.Decode("RelayHTTPSOrigin", raw, &origin) != nil || !loopbackAddress(config.TLSAddress) || !loopbackAddress(config.HTTPAddress) {
		return errors.New("invalid local Relay health configuration")
	}
	u, _ := url.Parse(origin)
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	for _, probe := range []struct {
		address string
		url     string
		status  int
		body    string
	}{
		{config.TLSAddress, origin + "/healthz", http.StatusOK, "ready\n"},
		{config.HTTPAddress, "http://" + u.Hostname() + "/relay-healthcheck", http.StatusNotFound, "ACME challenge unavailable\n"},
	} {
		transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: config.RootCAs, MinVersion: tls.VersionTLS12},
			DisableKeepAlives: true, ResponseHeaderTimeout: 2 * time.Second,
			DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, network, probe.address)
			}}
		client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		request, _ := http.NewRequestWithContext(ctx, http.MethodGet, probe.url, nil)
		response, err := client.Do(request)
		if err != nil {
			transport.CloseIdleConnections()
			return errors.New("Relay listener health check failed")
		}
		body, readErr := io.ReadAll(io.LimitReader(response.Body, 129))
		_ = response.Body.Close()
		transport.CloseIdleConnections()
		if readErr != nil || response.StatusCode != probe.status || string(body) != probe.body {
			return errors.New("Relay listener health check failed")
		}
	}
	return nil
}

func loopbackAddress(address string) bool {
	host, port, err := net.SplitHostPort(address)
	number, portErr := strconv.Atoi(port)
	ip := net.ParseIP(host)
	return err == nil && portErr == nil && number > 0 && number <= 65535 && ip != nil && ip.IsLoopback()
}
