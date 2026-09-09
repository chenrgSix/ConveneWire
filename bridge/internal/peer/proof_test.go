package peer

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	localwire "convenewire.dev/contracts/generated/go/localnode"
	wire "convenewire.dev/contracts/generated/go/peer"
)

type admissionFixture struct {
	Identity      IdentityProof               `json:"identity"`
	Preview       InvitationPreview           `json:"preview"`
	Now           string                      `json:"now"`
	Joined        Joined                      `json:"joined"`
	Entry         HumanEntry                  `json:"entry"`
	LocalIdentity localwire.LocalNodeIdentity `json:"localIdentity"`
	LocalProof    wire.PeerProof              `json:"localProof"`
}

func readAdmissionFixture(t *testing.T) (admissionFixture, time.Time) {
	t.Helper()
	raw, err := os.ReadFile("../../../packages/contracts/test/fixtures/peer-admission.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture admissionFixture
	if json.Unmarshal(raw, &fixture) != nil {
		t.Fatal("fixture decode")
	}
	at, err := time.Parse(time.RFC3339Nano, fixture.Now)
	if err != nil {
		t.Fatal(err)
	}
	return fixture, at
}
func cloneValue[T any](t *testing.T, v T) T {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var copy T
	if json.Unmarshal(raw, &copy) != nil {
		t.Fatal("clone")
	}
	return copy
}
func TestLocalSignerMatchesNativeHubKeyAndNodeProofBytes(t *testing.T) {
	f, now := readAdmissionFixture(t)
	signer, err := NewLocalSigner(f.LocalIdentity)
	if err != nil {
		t.Fatal(err)
	}
	p := f.LocalProof.Payload
	if signer.Identity().NodeID != p.SignerNodeID || signer.Identity().PublicKey != p.SignerPublicKey || signer.LocalUserID() != f.LocalIdentity.OwnerUserID {
		t.Fatal("installation identity drift")
	}
	context := ProofContext{Purpose: p.Purpose, AudienceNodeID: p.AudienceNodeID, OperationID: p.OperationID, Nonce: p.Nonce, SubjectDigest: p.SubjectDigest}
	proof, err := signer.Sign(context, now)
	if err != nil || !equalJSON(proof, f.LocalProof) {
		t.Fatal("Node/Go signer drift", err)
	}
	if VerifyProof(proof, signer.Identity(), context, now) != nil {
		t.Fatal("self proof")
	}
	for _, at := range []time.Time{now.Add(-6 * time.Second), now.Add(30 * time.Second)} {
		if VerifyProof(proof, signer.Identity(), context, at) == nil {
			t.Fatal("stale proof accepted")
		}
	}
	for _, field := range []string{"purpose", "audienceNodeId", "operationId", "nonce", "subjectDigest", "signerNodeId", "signerPublicKey"} {
		raw, _ := json.Marshal(proof)
		var value map[string]any
		_ = json.Unmarshal(raw, &value)
		payload := value["payload"].(map[string]any)
		payload[field] = "substituted"
		raw, _ = json.Marshal(value)
		var changed wire.PeerProof
		_ = json.Unmarshal(raw, &changed)
		if VerifyProof(changed, signer.Identity(), context, now) == nil {
			t.Fatal("substitution accepted", field)
		}
	}
}
func TestJoinedRejectsSignedReceiptAndExpectedContextSubstitution(t *testing.T) {
	f, now := readAdmissionFixture(t)
	j := f.Joined
	p := j.Runtime.Proof.Payload
	verify := func(value Joined, at time.Time) error {
		return VerifyJoined(value, j.Runtime.Invitation, j.Human.Participant, j.Human.LocalUserID, p.OperationID, p.Nonce, at)
	}
	if err := verify(j, now); err != nil {
		t.Fatal("Node-signed join", err)
	}
	for name, mutate := range map[string]func(*Joined){
		"host origin":     func(v *Joined) { v.Runtime.Invitation.HostOrigin = "https://changed.example.test" },
		"participant key": func(v *Joined) { v.Human.Participant.PublicKey = f.LocalProof.Payload.SignerPublicKey },
		"human token":     func(v *Joined) { v.Human.HumanCredential.Token = v.Runtime.MachineCredential.Token },
		"room": func(v *Joined) {
			v.Human.HumanCredential.Scope.RoomID = nil
			v.Human.HumanCredential.Scope.Kind = "team"
		},
		"human member":  func(v *Joined) { v.Human.HumanCredential.MembershipID = "peermember_substitute001" },
		"runtime token": func(v *Joined) { v.Runtime.MachineCredential.Token = v.Human.HumanCredential.Token },
		"local user":    func(v *Joined) { v.Human.LocalUserID = "user_substitute001" },
		"operation":     func(v *Joined) { v.Runtime.Proof.Payload.OperationID = "op_substitute001" },
		"nonce":         func(v *Joined) { v.Human.Proof.Payload.Nonce = f.LocalIdentity.Secret },
		"human expiry":  func(v *Joined) { v.Human.HumanCredential.ExpiresAt = "2030-01-01T00:00:00.000Z" },
	} {
		t.Run(name, func(t *testing.T) {
			value := cloneValue(t, j)
			mutate(&value)
			if verify(value, now) == nil {
				t.Fatal("receipt substitution accepted")
			}
		})
	}
	if verify(j, now.Add(30*time.Second)) == nil {
		t.Fatal("expired receipt accepted as a new join")
	}
	if VerifyJoined(j, j.Runtime.Invitation, j.Human.Participant, j.Human.LocalUserID, "op_wrongoperation", p.Nonce, now) == nil {
		t.Fatal("wrong intended operation accepted")
	}
	if err := validateHumanReceipt(j.Human, j.Runtime, j.Human.Participant, j.Human.LocalUserID); err != nil {
		t.Fatal("historical receipt", err)
	}
}
func TestHumanEntryPinsIdentityScopeOriginAndIndependentDeadlines(t *testing.T) {
	f, now := readAdmissionFixture(t)
	j := f.Joined
	e := f.Entry
	p := e.Proof.Payload
	verify := func(entry HumanEntry, at time.Time) error {
		return VerifyHumanEntry(entry, j.Human, j.Runtime, wire.PeerScope(e.Credential.Scope), p.OperationID, p.Nonce, at)
	}
	if err := verify(e, now); err != nil {
		t.Fatal("Node-signed entry", err)
	}
	for name, mutate := range map[string]func(*HumanEntry){
		"origin":             func(v *HumanEntry) { v.HostOrigin = "https://changed.example.test" },
		"audience":           func(v *HumanEntry) { v.Credential.Audience = "peer.runtime" },
		"room":               func(v *HumanEntry) { v.Credential.Scope.RoomID = nil; v.Credential.Scope.Kind = "team" },
		"member":             func(v *HumanEntry) { v.Credential.MembershipID = "peermember_substitute001" },
		"exchange extension": func(v *HumanEntry) { v.ExchangeExpiresAt = now.Add(2 * time.Minute).Format(peerTimeFormat) },
		"session extension":  func(v *HumanEntry) { v.Credential.ExpiresAt = now.Add(9 * time.Hour).Format(peerTimeFormat) },
		"nonce":              func(v *HumanEntry) { v.Proof.Payload.Nonce = f.LocalIdentity.Secret },
	} {
		t.Run(name, func(t *testing.T) {
			value := cloneValue(t, e)
			mutate(&value)
			if verify(value, now) == nil {
				t.Fatal("entry substitution accepted")
			}
		})
	}
	if verify(e, now.Add(time.Minute)) == nil {
		t.Fatal("expired entry accepted")
	}
}

func TestInvitationPreviewRequiresExactLinkPinsAndFreshOwnerReview(t *testing.T) {
	f, now := readAdmissionFixture(t)
	p := f.Preview.Proof.Payload
	host := f.Joined.Human.Host
	participant := f.Joined.Human.Participant
	verify := func(preview InvitationPreview, at time.Time) error {
		return VerifyInvitationPreview(preview, host, participant, f.Preview.Invitation.HostOrigin, f.Preview.Invitation.InvitationID, p.OperationID, p.Nonce, at)
	}
	if err := verify(f.Preview, now); err != nil {
		t.Fatal("Node-signed preview", err)
	}
	changed := cloneValue(t, f.Preview)
	changed.Invitation.Scope.Kind = "team"
	changed.Invitation.Scope.RoomID = nil
	if verify(changed, now) == nil {
		t.Fatal("scope substitution accepted")
	}
	host.NodeID = "node_substituted001"
	if verify(f.Preview, now) == nil {
		t.Fatal("wrong invitation link Host accepted")
	}
	host = f.Joined.Human.Host
	if verify(f.Preview, now.Add(30*time.Second)) == nil {
		t.Fatal("expired preview accepted")
	}
}

func TestAnonymousIdentityProofMatchesPinnedHostBeforeSecrets(t *testing.T) {
	f, now := readAdmissionFixture(t)
	p := f.Identity.Proof.Payload
	host := f.Joined.Human.Host
	if err := VerifyIdentityProof(f.Identity, host, f.Joined.Human.Participant, f.Identity.HostOrigin, p.OperationID, p.Nonce, now); err != nil {
		t.Fatal(err)
	}
	host.NodeID = "node_wronghost001"
	if VerifyIdentityProof(f.Identity, host, f.Joined.Human.Participant, f.Identity.HostOrigin, p.OperationID, p.Nonce, now) == nil {
		t.Fatal("unexpected Host accepted")
	}
	if VerifyIdentityProof(f.Identity, f.Joined.Human.Host, f.Joined.Human.Participant, "https://moved.example.test", p.OperationID, p.Nonce, now) == nil {
		t.Fatal("unexpected origin accepted")
	}
}
