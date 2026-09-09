package peer

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/privatefs"
	wire "convenewire.dev/contracts/generated/go/peer"
)

func pendingFixture(f admissionFixture) PendingJoin {
	return PendingJoin{SchemaVersion: 1, Participant: f.Joined.Human.Participant, LocalUserID: f.Joined.Human.LocalUserID,
		Invitation: f.Preview.Invitation, Secret: base64.RawURLEncoding.EncodeToString(make([]byte, 32)), OperationID: f.Preview.Proof.Payload.OperationID,
		DisplayName: "Invited human", PreviewProof: f.Preview.Proof, CreatedAt: f.Now}
}
func ownerStores(t *testing.T, f admissionFixture) (*Store, *HumanVault, *JoinJournal, string) {
	t.Helper()
	state := State{Participant: f.Joined.Human.Participant, LocalUserID: f.Joined.Human.LocalUserID}
	store, root := newStore(t, state)
	vault, err := OpenHumanVault(root, store)
	if err != nil {
		t.Fatal(err)
	}
	journal, err := OpenJoinJournal(store, vault)
	if err != nil {
		t.Fatal(err)
	}
	return store, vault, journal, root
}
func refreshFixtureProofs(t *testing.T, joined Joined, at time.Time, nonce string) Joined {
	t.Helper()
	result := cloneValue(t, joined)
	key := ed25519.NewKeyFromSeed([]byte{7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7})
	for _, proof := range []*wire.PeerProof{&result.Runtime.Proof, &result.Human.Proof} {
		proof.Payload.IssuedAt = at.Format(peerTimeFormat)
		proof.Payload.ExpiresAt = at.Add(30 * time.Second).Format(peerTimeFormat)
		proof.Payload.Nonce = nonce
		transcript, err := wire.ProofTranscript(wire.PeerProofPayload(proof.Payload))
		if err != nil {
			t.Fatal(err)
		}
		proof.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, transcript))
	}
	return result
}
func TestPendingJoinRecoversAfterOnlyRuntimeReceiptWasCommitted(t *testing.T) {
	f, now := readAdmissionFixture(t)
	store, _, journal, root := ownerStores(t, f)
	pending := pendingFixture(f)
	if err := journal.Save(pending, now); err != nil {
		t.Fatal(err)
	}
	if err := journal.Save(pending, now.Add(time.Hour)); err != nil {
		t.Fatal("frozen retry", err)
	}
	changed := pending
	changed.DisplayName = "Changed intent"
	if journal.Save(changed, now) == nil {
		t.Fatal("pending intent changed")
	}
	blocker := filepath.Join(root, "peer-human")
	if err := os.WriteFile(blocker, []byte("fixture failure"), 0600); err != nil {
		t.Fatal(err)
	}
	if journal.RecordJoined(pending.OperationID, f.Joined.Runtime.Proof.Payload.Nonce, f.Joined, now) == nil {
		t.Fatal("vault persistence failure ignored")
	}
	state, err := store.Read()
	if err != nil || len(state.Connections) != 1 {
		t.Fatal("Runtime receipt missing", err)
	}
	runtimeBytes, err := os.ReadFile(filepath.Join(root, "peer-state", "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(runtimeBytes), f.Joined.Human.HumanCredential.Token) {
		t.Fatal("human credential leaked into Runtime store")
	}
	if err = os.Remove(blocker); err != nil {
		t.Fatal(err)
	}
	restored, err := OpenStore(root, store.participant, store.localUserID)
	if err != nil {
		t.Fatal(err)
	}
	vault, err := OpenHumanVault(root, restored)
	if err != nil {
		t.Fatal(err)
	}
	journal, err = OpenJoinJournal(restored, vault)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := journal.Load(pending.OperationID)
	if err != nil || !equalJSON(loaded, pending) {
		t.Fatal("lost exact pending operation", err)
	}
	later := now.Add(time.Hour)
	if journal.RecordJoined(pending.OperationID, f.Joined.Runtime.Proof.Payload.Nonce, f.Joined, later) == nil {
		t.Fatal("stale Host response retrieved human secret")
	}
	nonce, _ := NewNonce()
	fresh := refreshFixtureProofs(t, f.Joined, later, nonce)
	if err = journal.RecordJoined(pending.OperationID, nonce, fresh, later); err != nil {
		t.Fatal("recover both receipts", err)
	}
	state, err = restored.Read()
	if err != nil || len(state.Connections) != 1 || !equalJSON(state.Connections[0].Receipt, f.Joined.Runtime) {
		t.Fatal("replaced original Runtime receipt", err)
	}
	human, err := vault.LoadForEntry(f.Joined.Runtime.Membership.MembershipID, later)
	if err != nil || human.HumanCredential.Token != f.Joined.Human.HumanCredential.Token {
		t.Fatal("human receipt recovery", err)
	}
	remaining, err := journal.Pending()
	if err != nil || len(remaining) != 0 {
		t.Fatal("completed pending operation retained", err)
	}
}
func TestHumanVaultConcurrentBindingAndLocalRevocationDoNotChangeRuntimeAuthority(t *testing.T) {
	f, now := readAdmissionFixture(t)
	store, vault, journal, _ := ownerStores(t, f)
	pending := pendingFixture(f)
	if err := journal.Save(pending, now); err != nil {
		t.Fatal(err)
	}
	if err := journal.RecordJoined(pending.OperationID, f.Joined.Runtime.Proof.Payload.Nonce, f.Joined, now); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := vault.Bind(f.Joined, now); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	vault.mu.Lock()
	state, _, err := vault.read()
	vault.mu.Unlock()
	if err != nil || state.Revision != 1 || len(state.Bindings) != 1 {
		t.Fatal("duplicate binding", err)
	}
	if err = vault.Revoke(f.Joined.Runtime.Membership.MembershipID); err != nil {
		t.Fatal(err)
	}
	if _, err = vault.LoadForEntry(f.Joined.Runtime.Membership.MembershipID, now); err == nil {
		t.Fatal("withdrawn human binding returned")
	}
	if vault.Bind(f.Joined, now) == nil {
		t.Fatal("claim replay restored withdrawn human binding")
	}
	runtime, err := store.Read()
	if err != nil || runtime.Connections[0].State != "active" {
		t.Fatal("human-only revoke altered Runtime", err)
	}
}
func TestHumanVaultRequiresCurrentRuntimeMembershipAndPrivateUntamperedHistory(t *testing.T) {
	f, now := readAdmissionFixture(t)
	store, vault, journal, root := ownerStores(t, f)
	pending := pendingFixture(f)
	if err := journal.Save(pending, now); err != nil {
		t.Fatal(err)
	}
	if err := journal.RecordJoined(pending.OperationID, f.Joined.Runtime.Proof.Payload.Nonce, f.Joined, now); err != nil {
		t.Fatal(err)
	}
	membershipID := f.Joined.Runtime.Membership.MembershipID
	filename := filepath.Join(root, "peer-human", "state.json")
	raw, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if err = os.Chmod(filename, 0644); err != nil {
			t.Fatal(err)
		}
		if _, err = vault.LoadForEntry(membershipID, now); err == nil {
			t.Fatal("public human secret file accepted")
		}
		_ = os.Chmod(filename, 0600)
	}
	var changed humanVaultState
	_ = json.Unmarshal(raw, &changed)
	changed.Bindings[0].Receipt.HumanCredential.Token = base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	modified, _ := json.Marshal(changed)
	if err = os.WriteFile(filename, modified, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = vault.LoadForEntry(membershipID, now); err == nil {
		t.Fatal("tampered signed human receipt accepted")
	}
	if err = os.WriteFile(filename, raw, 0600); err != nil {
		t.Fatal(err)
	}
	state, err := store.Read()
	if err != nil {
		t.Fatal(err)
	}
	prior := state.Revision
	state.Revision++
	state.Connections[0].State = "left"
	if err = store.Update(prior, state, now); err != nil {
		t.Fatal(err)
	}
	if _, err = vault.LoadForEntry(membershipID, now); err == nil {
		t.Fatal("withdrawn Runtime membership retained human access")
	}
	if err = os.Remove(filename); err != nil {
		t.Fatal(err)
	}
	if _, err = OpenHumanVault(root, store); err == nil {
		t.Fatal("missing established human file became empty state")
	}
}
func TestHumanVaultStoppedCopyAndObservedRollback(t *testing.T) {
	f, now := readAdmissionFixture(t)
	store, vault, journal, root := ownerStores(t, f)
	pending := pendingFixture(f)
	if err := journal.Save(pending, now); err != nil {
		t.Fatal(err)
	}
	if err := journal.RecordJoined(pending.OperationID, f.Joined.Runtime.Proof.Payload.Nonce, f.Joined, now); err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(root, "peer-human", "state.json")
	original, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	copyRoot := filepath.Join(t.TempDir(), "copy")
	if err = privatefs.CreateDirectory(copyRoot); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"peer-state", "peer-human"} {
		directory := filepath.Join(copyRoot, name)
		if err = privatefs.CreateDirectory(directory); err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(filepath.Join(root, name, "state.json"))
		if err != nil {
			t.Fatal(err)
		}
		if err = privatefs.WriteFile(filepath.Join(directory, "state.json"), raw); err != nil {
			t.Fatal(err)
		}
	}
	restored, err := OpenStore(copyRoot, store.participant, store.localUserID)
	if err != nil {
		t.Fatal(err)
	}
	copyVault, err := OpenHumanVault(copyRoot, restored)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = copyVault.LoadForEntry(f.Joined.Runtime.Membership.MembershipID, now); err != nil {
		t.Fatal("stopped copy", err)
	}
	if err = vault.Revoke(f.Joined.Runtime.Membership.MembershipID); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filename, original, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = vault.LoadForEntry(f.Joined.Runtime.Membership.MembershipID, now); err == nil {
		t.Fatal("running rollback accepted")
	}
}
