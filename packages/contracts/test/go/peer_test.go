package contracts_test

import (
	peer "convenewire.dev/contracts/generated/go/peer"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestPeerSharedContractFixtures(t *testing.T) {
	data, err := os.ReadFile("../fixtures/peer.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Cases []struct {
			Kind, Description string
			Value             json.RawMessage
			Valid             bool
		}
		Raw []struct {
			Kind, Raw string
			Valid     bool
		}
	}
	if err = json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, item := range fixtures.Cases {
		t.Run(item.Description, func(t *testing.T) {
			var value any
			if err := peer.Decode(item.Kind, item.Value, &value); (err == nil) != item.Valid {
				t.Fatalf("validity: %v", err)
			}
		})
	}
	for _, item := range fixtures.Raw {
		var grant peer.AgentExportGrant
		if err := peer.Decode(item.Kind, []byte(item.Raw), &grant); (err == nil) != item.Valid {
			t.Fatalf("raw validity %s: %v", item.Raw, err)
		}
	}
}

func TestPeerProofAndFreshness(t *testing.T) {
	data, err := os.ReadFile("../fixtures/peer-proof.json")
	if err != nil {
		t.Fatal(err)
	}
	var vector struct {
		Proof           peer.PeerProof
		Transcript, Now string
		Binding         json.RawMessage
	}
	if err = json.Unmarshal(data, &vector); err != nil {
		t.Fatal(err)
	}
	transcript, err := peer.ProofTranscript(peer.PeerProofPayload(vector.Proof.Payload))
	if err != nil || string(transcript) != vector.Transcript {
		t.Fatalf("transcript: %v", err)
	}
	digest, err := peer.Digest(vector.Binding)
	if err != nil || digest != vector.Proof.Payload.SubjectDigest {
		t.Fatalf("digest: %v", err)
	}
	key, _ := base64.RawURLEncoding.DecodeString(vector.Proof.Payload.SignerPublicKey)
	signature, _ := base64.RawURLEncoding.DecodeString(vector.Proof.Signature)
	if !ed25519.Verify(key, transcript, signature) {
		t.Fatal("signature failed")
	}
	now, err := time.Parse(time.RFC3339Nano, vector.Now)
	if err != nil {
		t.Fatal(err)
	}
	if !peer.ProofTimeValid(peer.PeerProofPayload(vector.Proof.Payload), now) || !peer.ProofTimeValid(peer.PeerProofPayload(vector.Proof.Payload), now.Add(-5*time.Second)) || peer.ProofTimeValid(peer.PeerProofPayload(vector.Proof.Payload), now.Add(-5*time.Second-time.Millisecond)) || peer.ProofTimeValid(peer.PeerProofPayload(vector.Proof.Payload), now.Add(30*time.Second)) {
		t.Fatal("freshness mismatch")
	}
	for _, field := range []*string{&vector.Proof.Payload.SignerNodeID, &vector.Proof.Payload.AudienceNodeID, &vector.Proof.Payload.OperationID, &vector.Proof.Payload.SubjectDigest} {
		original := *field
		*field += "x"
		changed, err := peer.ProofTranscript(peer.PeerProofPayload(vector.Proof.Payload))
		if err == nil && ed25519.Verify(key, changed, signature) {
			t.Fatal("changed pin verified")
		}
		*field = original
	}
}
