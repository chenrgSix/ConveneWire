package peer

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	localwire "convenewire.dev/contracts/generated/go/localnode"
	wire "convenewire.dev/contracts/generated/go/peer"
)

var ErrProof = errors.New("Peer proof does not match the pinned identity, intent or freshness")

const peerTimeFormat = "2006-01-02T15:04:05.000Z"

type ProofContext struct {
	Purpose        wire.Purpose
	AudienceNodeID string
	OperationID    string
	Nonce          string
	SubjectDigest  string
}

type Signer struct {
	identity    wire.PeerNodeIdentity
	localUserID string
	key         ed25519.PrivateKey
}

// NewLocalSigner uses the same installation key derivation as the native Hub.
// The owning core retains the root lease; neither the seed nor key is exported.
func NewLocalSigner(identity localwire.LocalNodeIdentity) (*Signer, error) {
	raw, err := json.Marshal(identity)
	if err != nil || localwire.Decode("LocalNodeIdentity", raw, &identity) != nil {
		return nil, ErrProof
	}
	seed := sha256.Sum256([]byte("convenewire.authority.local-seed.v1\x00" + identity.Secret))
	key := ed25519.NewKeyFromSeed(seed[:])
	return &Signer{identity: wire.PeerNodeIdentity{NodeID: identity.NodeID, PublicKey: base64.RawURLEncoding.EncodeToString(key.Public().(ed25519.PublicKey))}, localUserID: identity.OwnerUserID, key: key}, nil
}
func (s *Signer) Identity() wire.PeerNodeIdentity { return s.identity }
func (s *Signer) LocalUserID() string             { return s.localUserID }
func NewNonce() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
func (s *Signer) Sign(context ProofContext, now time.Time) (wire.PeerProof, error) {
	if s == nil || len(s.key) != ed25519.PrivateKeySize {
		return wire.PeerProof{}, ErrProof
	}
	payload := wire.PeerProofPayload{SchemaVersion: 1, Purpose: context.Purpose, AudienceNodeID: context.AudienceNodeID,
		OperationID: context.OperationID, Nonce: context.Nonce, SubjectDigest: context.SubjectDigest,
		SignerNodeID: s.identity.NodeID, SignerPublicKey: s.identity.PublicKey, IssuedAt: now.UTC().Format(peerTimeFormat),
		ExpiresAt: now.Add(wire.ProofLifetimeSeconds * time.Second).UTC().Format(peerTimeFormat)}
	transcript, err := wire.ProofTranscript(payload)
	if err != nil {
		return wire.PeerProof{}, ErrProof
	}
	return wire.PeerProof{Payload: wire.PeerProofPayloadClass(payload), Signature: base64.RawURLEncoding.EncodeToString(ed25519.Sign(s.key, transcript))}, nil
}
func VerifyProof(proof wire.PeerProof, signer wire.PeerNodeIdentity, context ProofContext, now time.Time) error {
	raw, err := json.Marshal(proof)
	if err != nil || wire.Decode("PeerProof", raw, &proof) != nil {
		return ErrProof
	}
	p := wire.PeerProofPayload(proof.Payload)
	if !wire.ProofTimeValid(p, now) || p.SignerNodeID != signer.NodeID || p.SignerPublicKey != signer.PublicKey ||
		p.Purpose != context.Purpose || p.AudienceNodeID != context.AudienceNodeID || p.OperationID != context.OperationID ||
		p.Nonce != context.Nonce || p.SubjectDigest != context.SubjectDigest {
		return ErrProof
	}
	transcript, err := wire.ProofTranscript(p)
	if err != nil {
		return ErrProof
	}
	key, err := base64.RawURLEncoding.DecodeString(signer.PublicKey)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return ErrProof
	}
	signature, err := base64.RawURLEncoding.DecodeString(proof.Signature)
	if err != nil || !ed25519.Verify(key, transcript, signature) {
		return ErrProof
	}
	return nil
}
func semanticDigest(value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return wire.Digest(raw)
}
func closed(kind string, value any) bool {
	raw, err := json.Marshal(value)
	var decoded any
	return err == nil && wire.Decode(kind, raw, &decoded) == nil
}
