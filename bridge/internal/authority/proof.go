// Package authority binds explicitly configured Device connectors to Host identity.
package authority

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/pairing"
	wire "convenewire.dev/contracts/generated/go/authority"
	executionwire "convenewire.dev/contracts/generated/go/runtime"
)

var ErrIdentity = errors.New("Authority identity, origin, credential or freshness mismatch")

type Binding struct {
	Pin              wire.AuthorityPin `json:"pin"`
	TeamID           string            `json:"teamId"`
	DeviceID         string            `json:"deviceId"`
	OwnerMemberID    string            `json:"ownerMemberId"`
	CredentialSHA256 string            `json:"credentialSha256"`
}

// Verified can only be constructed after authenticating a fresh Host proof.
type Verified struct {
	binding Binding
	payload wire.AuthorityProofPayload
}

func (v Verified) NodeID() string        { return v.binding.Pin.AuthorityNodeID }
func (v Verified) BrowserOrigin() string { return v.payload.BrowserOrigin }

type Verifier struct {
	binding    Binding
	credential pairing.Credential
	config     config.Config
}

func NewVerifier(cfg config.Config, credential pairing.Credential, pin wire.AuthorityPin) (*Verifier, error) {
	encoded, _ := json.Marshal(pin)
	if wire.Decode("AuthorityPin", encoded, &pin) != nil || ValidateOrigin(pin.ServerOrigin) != nil ||
		cfg.ServerURL != pin.ServerOrigin || credential.ServerURL != pin.ServerOrigin || credential.Token == "" {
		return nil, ErrIdentity
	}
	digest := sha256.Sum256([]byte(credential.Token))
	return &Verifier{binding: Binding{Pin: pin, TeamID: credential.TeamID, DeviceID: credential.DeviceID,
		OwnerMemberID: credential.OwnerMemberID, CredentialSHA256: hex.EncodeToString(digest[:])}, credential: credential, config: cfg}, nil
}

// ValidateOrigin accepts canonical origins only; remote plaintext is forbidden.
func ValidateOrigin(value string) error {
	u, err := url.Parse(value)
	if err != nil || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" ||
		u.Opaque != "" || u.Host == "" || u.String() != value || strings.ToLower(u.Host) != u.Host {
		return ErrIdentity
	}
	if port := u.Port(); port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 || strconv.Itoa(n) != port {
			return ErrIdentity
		}
	}
	if (u.Scheme == "https" && u.Port() == "443") || (u.Scheme == "http" && u.Port() == "80") {
		return ErrIdentity
	}
	if u.Scheme == "https" {
		return nil
	}
	host := u.Hostname()
	ip := net.ParseIP(host)
	if u.Scheme == "http" && (host == "localhost" || (ip != nil && ip.IsLoopback())) {
		return nil
	}
	return ErrIdentity
}

func (v *Verifier) Current(ctx context.Context) (Verified, error) {
	nonceBytes := make([]byte, 32)
	if _, err := rand.Read(nonceBytes); err != nil {
		return Verified{}, err
	}
	nonce := base64.RawURLEncoding.EncodeToString(nonceBytes)
	body, _ := json.Marshal(wire.AuthorityProofRequest{Nonce: nonce})
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, v.binding.Pin.ServerOrigin+"/api/bridge/authority-proof", bytes.NewReader(body))
	if err != nil {
		return Verified{}, ErrIdentity
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+v.credential.Token)
	if v.config.ServerToken != "" {
		request.Header.Set(config.ServerTokenHeader, v.config.ServerToken)
	}
	client := pairing.HTTPClientForCredential(v.config, v.credential)
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	defer client.CloseIdleConnections()
	response, err := client.Do(request)
	if err != nil {
		return Verified{}, ErrIdentity
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return Verified{}, ErrIdentity
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 16385))
	if err != nil || len(raw) > 16384 {
		return Verified{}, ErrIdentity
	}
	canonical, err := executionwire.CanonicalExecutionJSON(raw)
	if err != nil {
		return Verified{}, ErrIdentity
	}
	var proof wire.AuthorityProof
	if wire.Decode("AuthorityProof", canonical, &proof) != nil {
		return Verified{}, ErrIdentity
	}
	payload := wire.AuthorityProofPayload(proof.Payload)
	if err := verify(payload, v.binding, nonce, time.Now()); err != nil {
		return Verified{}, err
	}
	return Verified{binding: v.binding, payload: payload}, nil
}

func verify(p wire.AuthorityProofPayload, b Binding, nonce string, now time.Time) error {
	if p.AuthorityNodeID != b.Pin.AuthorityNodeID || p.PublicKey != b.Pin.PublicKey || p.TeamID != b.TeamID ||
		p.DeviceID != b.DeviceID || p.OwnerMemberID != b.OwnerMemberID || p.Nonce != nonce ||
		(p.BrowserOrigin != "" && ValidateOrigin(p.BrowserOrigin) != nil) {
		return ErrIdentity
	}
	start, e1 := time.Parse(time.RFC3339Nano, p.IssuedAt)
	end, e2 := time.Parse(time.RFC3339Nano, p.ExpiresAt)
	if e1 != nil || e2 != nil || !end.After(start) || end.Sub(start) > 30*time.Second ||
		start.After(now.Add(5*time.Second)) || !end.After(now.Add(-5*time.Second)) || now.Sub(start) > 35*time.Second {
		return ErrIdentity
	}
	key, e1 := base64.RawURLEncoding.Strict().DecodeString(p.PublicKey)
	signature, e2 := base64.RawURLEncoding.Strict().DecodeString(p.Signature)
	if e1 != nil || e2 != nil || len(key) != ed25519.PublicKeySize || len(signature) != ed25519.SignatureSize ||
		!ed25519.Verify(key, wire.ProofTranscript(p), signature) {
		return ErrIdentity
	}
	return nil
}
