package authority

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/delivery"
	"convenewire.dev/bridge/internal/identity"
	"convenewire.dev/bridge/internal/pairing"
	contracts "convenewire.dev/contracts/generated/go"
	wire "convenewire.dev/contracts/generated/go/authority"
)

func fixture(t *testing.T, id string) (Verified, pairing.Credential, ed25519.PrivateKey) {
	t.Helper()
	key := ed25519.NewKeyFromSeed([]byte(strings.Repeat("a", 32)))
	pin := wire.AuthorityPin{AuthorityNodeID: "node_" + id, ServerOrigin: "http://127.0.0.1:49123", PublicKey: base64.RawURLEncoding.EncodeToString(key.Public().(ed25519.PublicKey))}
	cred := pairing.Credential{ServerURL: pin.ServerOrigin, DeviceID: "device_fixture001", TeamID: "team_fixture001", OwnerMemberID: "member_fixture001", Token: "private-fixture-token"}
	v, err := NewVerifier(config.Config{ServerURL: cred.ServerURL}, cred, pin)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	p := wire.AuthorityProofPayload{AuthorityNodeID: pin.AuthorityNodeID, PublicKey: pin.PublicKey, TeamID: cred.TeamID, DeviceID: cred.DeviceID, OwnerMemberID: cred.OwnerMemberID, Nonce: base64.RawURLEncoding.EncodeToString(make([]byte, 32)), IssuedAt: now.Format("2006-01-02T15:04:05.000Z"), ExpiresAt: now.Add(30 * time.Second).Format("2006-01-02T15:04:05.000Z")}
	signFixture(&p, key)
	return Verified{binding: v.binding, payload: p}, cred, key
}
func signFixture(p *wire.AuthorityProofPayload, key ed25519.PrivateKey) {
	p.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, wire.ProofTranscript(*p)))
}

func TestProofRejectsWrongIdentityBindingNonceTimeSignatureAndOrigin(t *testing.T) {
	v, _, key := fixture(t, "fixture001")
	if err := verify(v.payload, v.binding, v.payload.Nonce, time.Now()); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"AuthorityNodeID", "PublicKey", "TeamID", "DeviceID", "OwnerMemberID", "Nonce", "BrowserOrigin", "IssuedAt", "ExpiresAt", "Signature"} {
		t.Run(field, func(t *testing.T) {
			p := v.payload
			reflect.ValueOf(&p).Elem().FieldByName(field).SetString("wrong")
			if verify(p, v.binding, v.payload.Nonce, time.Now()) == nil {
				t.Fatal("accepted changed field")
			}
		})
	}
	for _, span := range [][2]time.Duration{{-time.Minute, -30 * time.Second}, {10 * time.Second, 30 * time.Second}, {0, 31 * time.Second}, {0, 0}} {
		p := v.payload
		now := time.Now()
		p.IssuedAt = now.Add(span[0]).UTC().Format(time.RFC3339Nano)
		p.ExpiresAt = now.Add(span[1]).UTC().Format(time.RFC3339Nano)
		signFixture(&p, key)
		if verify(p, v.binding, p.Nonce, now) == nil {
			t.Fatal("accepted stale or excessive signed proof", span)
		}
	}
	for _, origin := range []string{"http://remote.test", "https://a.test/", "https://a.test:443", "http://127.0.0.1:80", "https://user@a.test", "https://a.test?q=secret", "https://a.test#x", "https://A.test", "http://127.0.0.1:99999", "http://127.0.0.1:0123"} {
		if ValidateOrigin(origin) == nil {
			t.Fatal("accepted origin", origin)
		}
	}
	for _, origin := range []string{"https://a.test", "https://a.test:8443", "http://127.0.0.1:1234", "http://[::1]:1234"} {
		if ValidateOrigin(origin) != nil {
			t.Fatal(origin)
		}
	}
}

func TestDeviceAuthenticatedProofDoesNotFollowRedirectsOrTrustForeignContext(t *testing.T) {
	v, cred, key := fixture(t, "fixture001")
	mode := "valid"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+cred.Token {
			w.WriteHeader(401)
			return
		}
		if mode == "redirect" {
			w.Header().Set("Location", "http://127.0.0.1:1/leak")
			w.WriteHeader(307)
			return
		}
		var req wire.AuthorityProofRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		p := v.payload
		p.Nonce = req.Nonce
		if mode == "foreign" {
			p.DeviceID = "device_other0001"
		}
		signFixture(&p, key)
		response := wire.AuthorityProof{ProtocolVersion: "1.0", MessageID: "msg_fixture001", Timestamp: p.IssuedAt, Type: "authority.proof", Payload: wire.Payload(p)}
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()
	cred.ServerURL = server.URL
	v.binding.Pin.ServerOrigin = server.URL
	verifier, err := NewVerifier(config.Config{ServerURL: server.URL}, cred, v.binding.Pin)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifier.Current(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, next := range []string{"redirect", "foreign"} {
		mode = next
		if _, err := verifier.Current(context.Background()); err == nil {
			t.Fatal(next)
		}
	}
	cred.ServerURL += "/"
	if _, err := NewVerifier(config.Config{ServerURL: server.URL}, cred, v.binding.Pin); err == nil {
		t.Fatal("accepted credential alias")
	}
}

func TestPrimaryAdoptionPreservesLegacyBytesAndRefusesRebindingOrMissingReceipt(t *testing.T) {
	root := t.TempDir()
	v, cred, _ := fixture(t, "primary001")
	if err := pairing.Save(root, cred); err != nil {
		t.Fatal(err)
	}
	ids, err := identity.LoadOrCreate(root, []config.AgentConfig{{Name: "Existing"}})
	if err != nil {
		t.Fatal(err)
	}
	// Adopt a real released Inbox record without recomputing its typed-payload hash.
	inbox, err := delivery.Open(filepath.Join(root, "inbox"))
	if err != nil {
		t.Fatal(err)
	}
	request := contracts.RunRequestedPayload{RunID: "run_collision001", TraceID: "trace_collision001", TargetAgentID: ids["Existing"], IdempotencyKey: "idem_collision001", DeliveryAttemptID: "delivery_collision001"}
	accepted, duplicate, err := inbox.Accept(request, time.Now())
	if err != nil || duplicate {
		t.Fatal(err)
	}
	file := filepath.Join(root, "inbox", "run_collision001.json")
	record, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := AdoptPrimary(root, v, ids); err != nil {
			t.Fatal(err)
		}
	}
	if got, _ := os.ReadFile(file); string(got) != string(record) {
		t.Fatal("rewrote history")
	}
	reopened, err := delivery.Open(filepath.Join(root, "inbox"))
	if err != nil {
		t.Fatal(err)
	}
	recovered, duplicate, err := reopened.Accept(request, time.Now())
	if err != nil || !duplicate || recovered.PayloadHash != accepted.PayloadHash {
		t.Fatal("lost original deduplication", err)
	}
	other, _, _ := fixture(t, "secondary01")
	partition, err := OpenPartition(root, other)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(partition, "inbox")); !os.IsNotExist(err) {
		t.Fatal("imported primary history")
	}
	if got, err := OpenPartition(root, other); err != nil || got != partition {
		t.Fatal(err)
	}
	changed := v
	changed.binding.DeviceID = "device_changed001"
	changed.payload.DeviceID = changed.binding.DeviceID
	if err := AdoptPrimary(root, changed, ids); err == nil {
		t.Fatal("accepted changed binding")
	}
	if _, err := ReadConfiguration(root); err == nil {
		t.Fatal("fell back to legacy after adoption")
	}
	receiptPath := filepath.Join(root, "authorities", "primary.json")
	if err := os.Remove(receiptPath); err != nil {
		t.Fatal(err)
	}
	if err := AdoptPrimary(root, v, ids); err == nil {
		t.Fatal("recreated missing receipt")
	}
}

func TestPartitionDeniesChangedCredentialIdentityAndUnreceiptedDirectory(t *testing.T) {
	root := t.TempDir()
	v, cred, _ := fixture(t, "primary001")
	_ = pairing.Save(root, cred)
	ids, _ := identity.LoadOrCreate(root, []config.AgentConfig{{Name: "Existing"}})
	if err := AdoptPrimary(root, v, ids); err != nil {
		t.Fatal(err)
	}
	other, _, key := fixture(t, "secondary01")
	partition, err := OpenPartition(root, other)
	if err != nil {
		t.Fatal(err)
	}
	changed := other
	changed.binding.CredentialSHA256 = strings.Repeat("f", 64)
	if _, err := OpenPartition(root, changed); err == nil {
		t.Fatal("accepted changed credential")
	}
	changed = other
	changed.payload.TeamID = "team_different01"
	changed.binding.TeamID = changed.payload.TeamID
	signFixture(&changed.payload, key)
	if _, err := OpenPartition(root, changed); err == nil {
		t.Fatal("accepted changed team")
	}
	if err := os.Remove(filepath.Join(partition, "receipt.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenPartition(root, other); err == nil {
		t.Fatal("adopted unknown history")
	}
	raw, _ := json.Marshal(ids)
	if err := os.WriteFile(filepath.Join(root, "agent-identities.json"), append(raw, ' '), 0600); err != nil {
		t.Fatal(err)
	}
	changedIDs := map[string]string{"Existing": "agent_replacement001"}
	if err := AdoptPrimary(root, v, changedIDs); err == nil {
		t.Fatal("accepted mismatched saved IDs")
	}
}

func TestLiveAuthorityProof(t *testing.T) {
	source := os.Getenv("CONVENE_WIRE_TEST_AUTHORITY")
	if source == "" {
		t.Skip("requires the authenticated Server interoperability fixture")
	}
	var fixture struct {
		Pin        wire.AuthorityPin
		Credential pairing.Credential
	}
	if json.Unmarshal([]byte(source), &fixture) != nil {
		t.Fatal("invalid fixture")
	}
	verifier, err := NewVerifier(config.Config{ServerURL: fixture.Pin.ServerOrigin}, fixture.Credential, fixture.Pin)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifier.Current(context.Background()); err != nil {
		t.Fatal(err)
	}
}
