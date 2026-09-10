package peer

import (
	"bytes"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"os"
	"path/filepath"
	"time"

	"convenewire.dev/bridge/internal/privatefs"
	wire "convenewire.dev/contracts/generated/go/peer"
)

var ErrTLSConfiguration = errors.New("Peer TLS configuration does not match the selected Host")

// NativeTLSConfiguration is an explicit owner-private configuration file.
// It adds trust only to this Peer client, never to the OS, browser or Device.
type NativeTLSConfiguration struct {
	SchemaVersion    int                   `json:"schemaVersion"`
	Host             wire.PeerNodeIdentity `json:"host"`
	HostOrigin       string                `json:"hostOrigin"`
	CACertificatePEM string                `json:"caCertificatePem"`
}

func nativeTLSRoots(root, origin string, host wire.PeerNodeIdentity) (*x509.CertPool, string, error) {
	if !filepath.IsAbs(root) || filepath.Clean(root) != root || ValidateOrigin(origin) != nil || !closed("PeerNodeIdentity", host) {
		return nil, "", ErrTLSConfiguration
	}
	if _, err := os.Lstat(root); err != nil || privatefs.EnsureDirectory(root) != nil {
		return nil, "", ErrTLSConfiguration
	}
	directory := filepath.Join(root, "peer-tls")
	for _, candidate := range []string{directory, filepath.Join(directory, host.NodeID)} {
		if _, err := os.Lstat(candidate); os.IsNotExist(err) {
			return nil, "system", nil
		} else if err != nil || privatefs.EnsureDirectory(candidate) != nil {
			return nil, "", ErrTLSConfiguration
		}
	}
	raw, err := privatefs.ReadFile(filepath.Join(directory, host.NodeID, "config.json"), 16*1024)
	if err != nil {
		return nil, "", ErrTLSConfiguration
	}
	canonical, err := wire.CanonicalJSON(raw)
	if err != nil {
		return nil, "", ErrTLSConfiguration
	}
	var cfg NativeTLSConfiguration
	decoder := json.NewDecoder(bytes.NewReader(canonical))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&cfg) != nil || cfg.SchemaVersion != 1 || cfg.Host != host || cfg.HostOrigin != origin {
		return nil, "", ErrTLSConfiguration
	}
	source := bytes.TrimSpace([]byte(cfg.CACertificatePEM))
	if !bytes.HasPrefix(source, []byte("-----BEGIN CERTIFICATE-----")) {
		return nil, "", ErrTLSConfiguration
	}
	block, rest := pem.Decode(source)
	if block == nil || block.Type != "CERTIFICATE" || len(block.Headers) != 0 || len(bytes.TrimSpace(rest)) != 0 {
		return nil, "", ErrTLSConfiguration
	}
	certificate, err := x509.ParseCertificate(block.Bytes)
	now := time.Now()
	if err != nil || !certificate.IsCA || !certificate.BasicConstraintsValid || certificate.KeyUsage&x509.KeyUsageCertSign == 0 ||
		now.Before(certificate.NotBefore) || !now.Before(certificate.NotAfter) {
		return nil, "", ErrTLSConfiguration
	}
	roots := x509.NewCertPool()
	roots.AddCert(certificate)
	digest, err := wire.Digest(canonical)
	if err != nil {
		return nil, "", ErrTLSConfiguration
	}
	return roots, digest, nil
}

// The exact Node key/origin pin is still verified independently. Changing TLS
// configuration while a proof/request is in flight invalidates this client;
// a new client must complete normal TLS and a fresh pinned Host proof again.
func NewNativeClient(root, origin string, host wire.PeerNodeIdentity, signer *Signer, checkIdentity func() error) (*Client, error) {
	if checkIdentity == nil || checkIdentity() != nil {
		return nil, ErrProof
	}
	roots, digest, err := nativeTLSRoots(root, origin, host)
	if err != nil {
		return nil, err
	}
	client, err := NewClient(origin, host, signer, roots)
	if err != nil {
		return nil, err
	}
	client.beforeOperation = func() error {
		if err := checkIdentity(); err != nil {
			return err
		}
		_, current, err := nativeTLSRoots(root, origin, host)
		if err != nil || current != digest {
			return ErrTLSConfiguration
		}
		return nil
	}
	return client, nil
}
