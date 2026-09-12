package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"syscall"

	"convenewire.dev/relay"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) > 0 && args[0] == "healthcheck" {
		return healthcheck(args[1:])
	}
	flags := flag.NewFlagSet("convenewire-relay", flag.ContinueOnError)
	origin := flags.String("relay-origin", "", "public HTTPS origin for the Relay control service")
	domain := flags.String("node-domain", "", "dedicated wildcard DNS domain for Node addresses")
	tlsAddress := flags.String("tls-listen", ":443", "public TLS listener")
	httpAddress := flags.String("http-listen", ":80", "HTTP-01 listener")
	certificate := flags.String("tls-cert", "", "control service certificate PEM file")
	key := flags.String("tls-key", "", "control service private key PEM file")
	maxConnections := flags.Int("max-connections", 512, "global inbound connection limit")
	maxNodes := flags.Int("max-nodes", 128, "simultaneous registered Nodes")
	maxStreams := flags.Int("max-streams-per-node", 32, "simultaneous pending or attached streams per Node")
	maxBytes := flags.Int64("max-stream-bytes", 256*1024*1024, "combined transfer byte ceiling per stream")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected Relay arguments")
	}
	cert, err := tls.LoadX509KeyPair(*certificate, *key)
	if err != nil {
		return fmt.Errorf("could not load Relay control TLS material")
	}
	server, err := relay.New(relay.Config{RelayOrigin: *origin, NodeDomain: *domain, ControlTLS: &tls.Config{Certificates: []tls.Certificate{cert}},
		MaxConnections: *maxConnections, MaxNodes: *maxNodes, MaxStreamsPerNode: *maxStreams, MaxStreamBytes: *maxBytes})
	if err != nil {
		return err
	}
	defer server.Close()
	publicTLS, err := net.Listen("tcp", *tlsAddress)
	if err != nil {
		return fmt.Errorf("could not bind Relay TLS listener")
	}
	defer publicTLS.Close()
	publicHTTP, err := net.Listen("tcp", *httpAddress)
	if err != nil {
		return fmt.Errorf("could not bind Relay HTTP-01 listener")
	}
	defer publicHTTP.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() { <-ctx.Done(); _ = server.Close() }()
	// Only public listener addresses are emitted. No registrations or payloads
	// are logged, and panic/error text never incorporates request input.
	go func() {
		select {
		case <-server.Ready():
			fmt.Printf("Relay ready tls=%s http01=%s\n", publicTLS.Addr(), publicHTTP.Addr())
		case <-ctx.Done():
		}
	}()
	err = server.Serve(publicTLS, publicHTTP)
	if errors.Is(err, relay.ErrClosed) && ctx.Err() != nil {
		return nil
	}
	return err
}

func healthcheck(args []string) error {
	flags := flag.NewFlagSet("convenewire-relay healthcheck", flag.ContinueOnError)
	origin := flags.String("relay-origin", "", "public control HTTPS origin; hostname verification remains enabled")
	tlsAddress := flags.String("tls-address", "127.0.0.1:8443", "local loopback TLS listener")
	httpAddress := flags.String("http-address", "127.0.0.1:8080", "local loopback HTTP-01 listener")
	caFile := flags.String("ca-file", "", "optional CA roots PEM file for a private control CA")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected healthcheck arguments")
	}
	var roots *x509.CertPool
	if *caFile != "" {
		pem, err := os.ReadFile(*caFile)
		if err != nil {
			return fmt.Errorf("could not read healthcheck CA roots")
		}
		roots = x509.NewCertPool()
		if !roots.AppendCertsFromPEM(pem) {
			return fmt.Errorf("invalid healthcheck CA roots")
		}
	}
	return relay.CheckHealth(context.Background(), relay.HealthConfig{RelayOrigin: *origin, TLSAddress: *tlsAddress, HTTPAddress: *httpAddress, RootCAs: roots})
}
