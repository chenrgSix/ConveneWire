package contracts_test

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"

	peer "convenewire.dev/contracts/generated/go/peer"
)

func TestRelaySharedSchemaAndSignedVector(t *testing.T) {
	data, err := os.ReadFile("../fixtures/relay.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Seed, RelayOrigin, NodeDomain, Nonce, NodeID, PublicKey, Transcript, Signature, Hostname string
		Cases                                                                                    []struct {
			Kind, Description string
			Value             json.RawMessage
			Valid             bool
		}
		Raw []struct {
			Kind, Raw string
			Valid     bool
		}
		Profile    json.RawMessage
		Challenge  json.RawMessage
		Register   json.RawMessage
		Registered json.RawMessage
		Open       json.RawMessage
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, entry := range fixture.Cases {
		t.Run(entry.Description, func(t *testing.T) {
			var value any
			if err := peer.Decode(entry.Kind, entry.Value, &value); (err == nil) != entry.Valid {
				t.Fatalf("schema validity: %v", err)
			}
		})
	}
	for _, entry := range fixture.Raw {
		var value any
		if err := peer.Decode(entry.Kind, []byte(entry.Raw), &value); (err == nil) != entry.Valid {
			t.Fatalf("raw validity %s: %v", entry.Raw, err)
		}
	}
	for _, entry := range []struct {
		kind   string
		raw    json.RawMessage
		target any
	}{
		{"RelayServiceProfile", fixture.Profile, &peer.RelayServiceProfile{}},
		{"RelayChallenge", fixture.Challenge, &peer.RelayChallenge{}},
		{"RelayRegister", fixture.Register, &peer.RelayRegister{}},
		{"RelayRegistered", fixture.Registered, &peer.RelayRegistered{}},
		{"RelayOpen", fixture.Open, &peer.RelayOpen{}},
	} {
		if err := peer.Decode(entry.kind, entry.raw, entry.target); err != nil {
			t.Fatal(err)
		}
	}
	transcript, err := peer.RelayRegistrationTranscript(fixture.RelayOrigin, fixture.NodeDomain, fixture.Nonce, fixture.NodeID, fixture.PublicKey)
	if err != nil || string(transcript) != fixture.Transcript {
		t.Fatalf("transcript: %v", err)
	}
	hostname, err := peer.RelayHostname(fixture.PublicKey, fixture.NodeDomain)
	if err != nil || hostname != fixture.Hostname {
		t.Fatalf("hostname: %v", err)
	}
	seed, _ := hex.DecodeString(fixture.Seed)
	key := ed25519.NewKeyFromSeed(seed)
	if base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, transcript)) != fixture.Signature {
		t.Fatal("signature bytes differ")
	}
	signature, _ := base64.RawURLEncoding.Strict().DecodeString(fixture.Signature)
	if !ed25519.Verify(key.Public().(ed25519.PublicKey), transcript, signature) {
		t.Fatal("signature not valid")
	}
	for _, entry := range fixture.Cases {
		if entry.Valid {
			continue
		}
		if entry.Kind == "RelayNodeDomain" {
			var domain string
			_ = json.Unmarshal(entry.Value, &domain)
			if _, err := peer.RelayHostname(fixture.PublicKey, domain); err == nil {
				t.Fatal(entry.Description)
			}
			if _, err := peer.RelayRegistrationTranscript(fixture.RelayOrigin, domain, fixture.Nonce, fixture.NodeID, fixture.PublicKey); err == nil {
				t.Fatal(entry.Description)
			}
		}
		if entry.Kind == "RelayHTTPSOrigin" {
			var origin string
			_ = json.Unmarshal(entry.Value, &origin)
			if _, err := peer.RelayRegistrationTranscript(origin, fixture.NodeDomain, fixture.Nonce, fixture.NodeID, fixture.PublicKey); err == nil {
				t.Fatal(entry.Description)
			}
		}
	}
}
