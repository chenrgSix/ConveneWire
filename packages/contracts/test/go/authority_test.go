package contracts_test

import (
	authority "convenewire.dev/contracts/generated/go/authority"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"
)

func TestAuthorityFoundationSharedFixtures(t *testing.T) {
	source, err := os.ReadFile("../fixtures/authority.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Kind        string
		Valid       bool
		Value       json.RawMessage
		Description string
	}
	if err := json.Unmarshal(source, &cases); err != nil {
		t.Fatal(err)
	}
	for _, item := range cases {
		t.Run(item.Description, func(t *testing.T) {
			var result any
			if err := authority.Decode(item.Kind, item.Value, &result); (err == nil) != item.Valid {
				t.Fatalf("validity mismatch: %v", err)
			}
		})
	}
}

func TestAuthorityProofTranscriptAndSignature(t *testing.T) {
	source, err := os.ReadFile("../fixtures/authority-proof-vector.json")
	if err != nil {
		t.Fatal(err)
	}
	var vector struct {
		Payload    authority.AuthorityProofPayload
		Transcript string
	}
	if err := json.Unmarshal(source, &vector); err != nil {
		t.Fatal(err)
	}
	transcript := authority.ProofTranscript(vector.Payload)
	if string(transcript) != vector.Transcript {
		t.Fatal("transcript differs from TypeScript")
	}
	key, err := base64.RawURLEncoding.DecodeString(vector.Payload.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	signature, err := base64.RawURLEncoding.DecodeString(vector.Payload.Signature)
	if err != nil {
		t.Fatal(err)
	}
	if !ed25519.Verify(key, transcript, signature) {
		t.Fatal("shared signature is invalid")
	}
	for _, field := range []*string{&vector.Payload.AuthorityNodeID, &vector.Payload.PublicKey, &vector.Payload.TeamID, &vector.Payload.DeviceID, &vector.Payload.OwnerMemberID, &vector.Payload.BrowserOrigin, &vector.Payload.Nonce, &vector.Payload.IssuedAt, &vector.Payload.ExpiresAt} {
		original := *field
		*field += "x"
		if ed25519.Verify(key, authority.ProofTranscript(vector.Payload), signature) {
			t.Fatal("changed scope verified")
		}
		*field = original
	}
}
