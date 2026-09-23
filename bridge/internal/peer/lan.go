package peer

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"convenewire.dev/bridge/internal/durablefs"
	"convenewire.dev/bridge/internal/privatefs"
	wire "convenewire.dev/contracts/generated/go/peer"
)

type LANTransport struct {
	SchemaVersion    int                    `json:"schemaVersion"`
	Host             wire.PeerNodeIdentity  `json:"host"`
	HostOrigin       string                 `json:"hostOrigin"`
	CACertificatePEM string                 `json:"caCertificatePem"`
	Endpoints        []wire.PeerLANEndpoint `json:"endpoints"`
	ExpiresAt        string                 `json:"expiresAt"`
}
type LANProof struct {
	Transport LANTransport `json:"transport"`
	Signature string       `json:"signature"`
}

func lanRoots(proof LANProof, origin string, host wire.PeerNodeIdentity, fresh bool, now time.Time) (*x509.CertPool, error) {
	if !closed("PeerLANSignedTransport", proof) || proof.Transport.Host != host || proof.Transport.HostOrigin != origin || ValidateOrigin(origin) != nil {
		return nil, ErrTLSConfiguration
	}
	t := proof.Transport
	expires, err := time.Parse(peerTimeFormat, t.ExpiresAt)
	if err != nil || (fresh && (!expires.After(now) || expires.After(now.Add(time.Hour+5*time.Second)))) {
		return nil, ErrTLSConfiguration
	}
	for _, endpoint := range t.Endpoints {
		ip := net.ParseIP(endpoint.Address)
		if ip == nil || ip.To4() == nil || !ip.IsPrivate() || ip.String() != endpoint.Address {
			return nil, ErrTLSConfiguration
		}
	}
	raw, err := json.Marshal(map[string]any{"domain": "convenewire.peer.lan.v1", "transport": t})
	if err != nil {
		return nil, ErrTLSConfiguration
	}
	transcript, err := wire.CanonicalJSON(raw)
	key, keyErr := base64.RawURLEncoding.DecodeString(host.PublicKey)
	signature, sigErr := base64.RawURLEncoding.DecodeString(proof.Signature)
	if err != nil || keyErr != nil || sigErr != nil || len(key) != ed25519.PublicKeySize || !ed25519.Verify(key, transcript, signature) {
		return nil, ErrTLSConfiguration
	}
	source := bytes.TrimSpace([]byte(t.CACertificatePEM))
	if !bytes.HasPrefix(source, []byte("-----BEGIN CERTIFICATE-----")) {
		return nil, ErrTLSConfiguration
	}
	block, rest := pem.Decode(source)
	if block == nil || block.Type != "CERTIFICATE" || len(block.Headers) != 0 || len(bytes.TrimSpace(rest)) != 0 {
		return nil, ErrTLSConfiguration
	}
	ca, err := x509.ParseCertificate(block.Bytes)
	if err != nil || !ca.IsCA || !ca.BasicConstraintsValid || ca.KeyUsage&x509.KeyUsageCertSign == 0 || now.Before(ca.NotBefore) || !now.Before(ca.NotAfter) || ca.CheckSignatureFrom(ca) != nil {
		return nil, ErrTLSConfiguration
	}
	roots := x509.NewCertPool()
	roots.AddCert(ca)
	return roots, nil
}

// Signed endpoint data is transport only. Normal TLS hostname verification and
// the fresh Host proof still run before any invitation or credential is sent.
func configureLANDial(client *Client, transport LANTransport) {
	origin, _ := url.Parse(transport.HostOrigin)
	port := origin.Port()
	if port == "" {
		port = "443"
	}
	expected := net.JoinHostPort(origin.Hostname(), port)
	client.transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		if network != "tcp" || address != expected {
			return nil, ErrTLSConfiguration
		}
		for _, endpoint := range transport.Endpoints {
			dialer := net.Dialer{Timeout: 2 * time.Second, KeepAlive: 30 * time.Second}
			conn, err := dialer.DialContext(ctx, "tcp4", net.JoinHostPort(endpoint.Address, strconv.FormatInt(endpoint.Port, 10)))
			if err == nil {
				return conn, nil
			}
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
		}
		return nil, ErrTransport
	}
}

func readLANTrust(root, origin string, host wire.PeerNodeIdentity) (*LANProof, string, error) {
	if !filepath.IsAbs(root) || filepath.Clean(root) != root || !closed("PeerNodeIdentity", host) || ValidateOrigin(origin) != nil {
		return nil, "", ErrTLSConfiguration
	}
	directory := filepath.Join(root, "peer-lan", host.NodeID)
	for _, candidate := range []string{root, filepath.Dir(directory), directory} {
		if _, err := os.Lstat(candidate); errors.Is(err, os.ErrNotExist) && candidate != root {
			return nil, "", nil
		} else if err != nil || privatefs.EnsureDirectory(candidate) != nil {
			return nil, "", ErrTLSConfiguration
		}
	}
	raw, err := privatefs.ReadFile(filepath.Join(directory, "config.json"), 16384)
	var proof LANProof
	if err != nil || wire.Decode("PeerLANSignedTransport", raw, &proof) != nil {
		return nil, "", ErrTLSConfiguration
	}
	if _, err := lanRoots(proof, origin, host, false, time.Now()); err != nil {
		return nil, "", err
	}
	digest, err := wire.Digest(raw)
	return &proof, digest, err
}

var lanTrustWrite sync.Mutex

func saveLANTrust(root string, proof LANProof) error {
	lanTrustWrite.Lock()
	defer lanTrustWrite.Unlock()
	t := proof.Transport
	if _, err := lanRoots(proof, t.HostOrigin, t.Host, true, time.Now()); err != nil {
		return err
	}
	prior, _, err := readLANTrust(root, t.HostOrigin, t.Host)
	if err != nil {
		return err
	}
	if prior != nil && prior.Transport.CACertificatePEM != t.CACertificatePEM {
		return ErrTLSConfiguration
	}
	directory := filepath.Join(root, "peer-lan", t.Host.NodeID)
	if err := privatefs.EnsureDirectory(filepath.Dir(directory)); err != nil {
		return err
	}
	nonce, err := NewNonce()
	if err != nil {
		return err
	}
	raw, err := json.Marshal(proof)
	if err != nil {
		return err
	}
	if prior == nil {
		// Publish the first complete trust directory in one rename. Interrupted
		// staging must not leave an empty confirmed pin that prevents recovery.
		staged := filepath.Join(filepath.Dir(directory), ".pending-"+nonce)
		if err := privatefs.CreateDirectory(staged); err != nil {
			return err
		}
		defer os.RemoveAll(staged)
		if err := privatefs.WriteFile(filepath.Join(staged, "config.json"), raw); err != nil {
			return err
		}
		if err := os.Rename(staged, directory); err != nil {
			return err
		}
		return durablefs.SyncParent(directory)
	}
	temporary := filepath.Join(directory, "."+nonce+".tmp")
	defer os.Remove(temporary)
	if err := privatefs.WriteFile(temporary, raw); err != nil {
		return err
	}
	if err := os.Rename(temporary, filepath.Join(directory, "config.json")); err != nil {
		return err
	}
	return durablefs.SyncParent(filepath.Join(directory, "config.json"))
}

func (o *OwnerAccess) invitationClient(input InvitationInput) (*Client, error) {
	if input.LAN == nil {
		return o.client(input.HostOrigin, input.Host)
	}
	state, err := o.store.Read()
	if err != nil {
		return nil, err
	}
	for _, connection := range state.Connections {
		invitation := connection.Receipt.Invitation
		if invitation.Host.NodeID == input.Host.NodeID && (invitation.Host.PublicKey != input.Host.PublicKey || invitation.HostOrigin != input.HostOrigin) {
			return nil, ErrTLSConfiguration
		}
	}
	roots, err := lanRoots(*input.LAN, input.HostOrigin, input.Host, true, o.clock())
	if err != nil {
		return nil, err
	}
	prior, _, err := readLANTrust(o.root, input.HostOrigin, input.Host)
	if err != nil || (prior != nil && prior.Transport.CACertificatePEM != input.LAN.Transport.CACertificatePEM) {
		return nil, ErrTLSConfiguration
	}
	client, err := NewClient(input.HostOrigin, input.Host, o.signer, roots)
	if err != nil {
		return nil, err
	}
	configureLANDial(client, input.LAN.Transport)
	client.beforeOperation = o.check
	client.clock = o.clock
	return client, nil
}

// ManagedLAN reports scoped native transport without exposing public CA material.
func ManagedLAN(root, origin string, host wire.PeerNodeIdentity) (bool, error) {
	proof, _, err := readLANTrust(root, origin, host)
	return proof != nil, err
}
