package peer

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/privatefs"
	wire "convenewire.dev/contracts/generated/go/peer"
)

func fixtureState(t *testing.T) (State, State, time.Time) {
	t.Helper()
	raw, err := os.ReadFile("../../../packages/contracts/test/fixtures/peer-join.json")
	if err != nil {
		t.Fatal(err)
	}
	var data struct {
		Now               string
		State, Authorized State
	}
	if json.Unmarshal(raw, &data) != nil {
		t.Fatal("fixture decode")
	}
	now, err := time.Parse(time.RFC3339Nano, data.Now)
	if err != nil {
		t.Fatal(err)
	}
	return data.State, data.Authorized, now
}
func newStore(t *testing.T, state State) (*Store, string) {
	t.Helper()
	root := filepath.Join(t.TempDir(), "private")
	if err := privatefs.CreateDirectory(root); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(root, state.Participant, state.LocalUserID)
	if err != nil {
		t.Fatal(err)
	}
	return store, root
}
func cloneState(t *testing.T, state State) State {
	t.Helper()
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	var copied State
	if json.Unmarshal(raw, &copied) != nil {
		t.Fatal("clone")
	}
	return copied
}

func TestStorePreservesSignedJoinBilateralHistoryAndWithdrawal(t *testing.T) {
	state, authorized, now := fixtureState(t)
	store, root := newStore(t, state)
	empty, err := store.Read()
	if err != nil || empty.Revision != 0 || len(empty.Connections) != 0 {
		t.Fatal("new store", err)
	}
	if err = store.Update(0, state, now); err != nil {
		t.Fatal("join", err)
	}
	if err = store.Update(1, authorized, now); err != nil {
		t.Fatal("authorize", err)
	}
	reopened, err := OpenStore(root, state.Participant, state.LocalUserID)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := reopened.Read()
	if err != nil || !equalJSON(actual, authorized) {
		t.Fatal("reopen", err)
	}
	// Reading and reconciling old truth do not require the original short proof to remain live.
	left := cloneState(t, authorized)
	left.Revision = 3
	left.Connections[0].State = "left"
	if err = reopened.Update(2, left, now.Add(48*time.Hour)); err != nil {
		t.Fatal("leave", err)
	}
	resurrect := cloneState(t, left)
	resurrect.Revision = 4
	resurrect.Connections[0].State = "active"
	if !errors.Is(reopened.Update(3, resurrect, now), ErrStore) {
		t.Fatal("withdrawal revived")
	}
	path := filepath.Join(root, "peer-state", "state.json")
	raw, err := privatefs.ReadFile(path, wire.MaximumJSONBytes)
	if err != nil {
		t.Fatal(err)
	}
	// A stopped copy retains the exact key, receipt, credentials, consent history and left state.
	restoredRoot := filepath.Join(t.TempDir(), "restored")
	if err = privatefs.CreateDirectory(restoredRoot); err != nil {
		t.Fatal(err)
	}
	if err = privatefs.CreateDirectory(filepath.Join(restoredRoot, "peer-state")); err != nil {
		t.Fatal(err)
	}
	if err = privatefs.WriteFile(filepath.Join(restoredRoot, "peer-state", "state.json"), raw); err != nil {
		t.Fatal(err)
	}
	restored, err := OpenStore(restoredRoot, state.Participant, state.LocalUserID)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := restored.Read()
	if err != nil || !equalJSON(recovered, left) {
		t.Fatal("restore", err)
	}
}

func TestStoreRejectsIdentitySignatureScopeAndMissingHistory(t *testing.T) {
	state, authorized, now := fixtureState(t)
	for _, change := range []func(*State){
		func(s *State) { s.Connections[0].Receipt.Invitation.HostOrigin = "https://other.example.test" },
		func(s *State) { s.Connections[0].Receipt.Membership.MemberID = "member_replaced001" },
		func(s *State) { s.Connections[0].Receipt.Membership.LocalUserID = "user_replaced001" },
		func(s *State) {
			s.Connections[0].Receipt.MachineCredential.Token = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
		},
		func(s *State) { s.Connections[0].Receipt.Proof.Payload.AudienceNodeID = "node_replaced001" },
		func(s *State) {
			s.Connections[0].Receipt.Proof.Signature = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
		},
	} {
		store, _ := newStore(t, state)
		bad := cloneState(t, state)
		change(&bad)
		if !errors.Is(store.Update(0, bad, now), ErrStore) {
			t.Fatal("changed receipt accepted")
		}
	}
	store, root := newStore(t, state)
	if !errors.Is(store.Update(0, state, now.Add(30*time.Second)), ErrStore) {
		t.Fatal("stale new join")
	}
	if err := store.Update(0, state, now); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenStore(root, state.Participant, "user_otherowner001"); !errors.Is(err, ErrStore) {
		t.Fatal("changed owner")
	}
	otherKey := state.Participant
	otherKey.PublicKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	if _, err := OpenStore(root, otherKey, state.LocalUserID); !errors.Is(err, ErrStore) {
		t.Fatal("changed key")
	}
	if err := store.Update(1, authorized, now); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*State){
		func(s *State) { s.Connections = nil },
		func(s *State) { s.Connections[0].Exports = []wire.AgentExportGrant{} },
		func(s *State) { s.Connections[0].Exports[0].LocalAgentID = "agent_replaced001" },
		func(s *State) { s.Connections[0].Acceptances[0].Capabilities.SupportsOwnerPrivateOutput = true },
	} {
		bad := cloneState(t, authorized)
		bad.Revision = 3
		change(&bad)
		if !errors.Is(store.Update(2, bad, now), ErrStore) {
			t.Fatal("history changed")
		}
	}
	if err := os.Remove(filepath.Join(root, "peer-state", "state.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Read(); !errors.Is(err, ErrStore) {
		t.Fatal("missing record initialized")
	}
	if !errors.Is(store.Update(0, state, now), ErrStore) {
		t.Fatal("missing record restored automatically")
	}
}

func TestStoreHasOneCASWinnerAndRejectsRunningRollback(t *testing.T) {
	state, authorized, now := fixtureState(t)
	store, root := newStore(t, state)
	if err := store.Update(0, state, now); err != nil {
		t.Fatal(err)
	}
	oldBytes, err := os.ReadFile(filepath.Join(root, "peer-state", "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	var winners atomic.Int64
	var wg sync.WaitGroup
	for range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			other, err := OpenStore(root, state.Participant, state.LocalUserID)
			if err != nil {
				t.Error(err)
				return
			}
			err = other.Update(1, authorized, now)
			if err == nil {
				winners.Add(1)
			} else if !errors.Is(err, ErrConflict) {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if winners.Load() != 1 {
		t.Fatal("CAS winners", winners.Load())
	}
	if _, err = store.Read(); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, "peer-state", "state.json"), oldBytes, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Read(); !errors.Is(err, ErrStore) {
		t.Fatal("running rollback accepted")
	}
}

func TestStoreRejectsRevokedAndRetiredGrantRevival(t *testing.T) {
	state, authorized, now := fixtureState(t)
	store, _ := newStore(t, state)
	if err := store.Update(0, state, now); err != nil {
		t.Fatal(err)
	}
	if err := store.Update(1, authorized, now); err != nil {
		t.Fatal(err)
	}
	revoked := cloneState(t, authorized)
	revoked.Revision = 3
	g := revoked.Connections[0].Exports[0]
	g.Revision = 2
	g.State = "revoked"
	revoked.Connections[0].Exports = append(revoked.Connections[0].Exports, g)
	if err := store.Update(2, revoked, now); err != nil {
		t.Fatal(err)
	}
	bad := cloneState(t, revoked)
	bad.Revision = 4
	g.Revision = 3
	g.State = "active"
	bad.Connections[0].Exports = append(bad.Connections[0].Exports, g)
	if !errors.Is(store.Update(3, bad, now), ErrStore) {
		t.Fatal("revoked grant revived")
	}
	fresh := cloneState(t, revoked)
	fresh.Revision = 4
	g.ExportID = "export_replacement01"
	g.Revision = 1
	fresh.Connections[0].Exports = append(fresh.Connections[0].Exports, g)
	if err := store.Update(3, fresh, now); err != nil {
		t.Fatal(err)
	}
	second, _ := newStore(t, state)
	if err := second.Update(0, state, now); err != nil {
		t.Fatal(err)
	}
	if err := second.Update(1, authorized, now); err != nil {
		t.Fatal(err)
	}
	retired := cloneState(t, authorized)
	retired.Revision = 3
	other := retired.Connections[0].Exports[0]
	other.ExportID = "export_replacement02"
	retired.Connections[0].Exports = append(retired.Connections[0].Exports, other)
	if err := second.Update(2, retired, now); err != nil {
		t.Fatal(err)
	}
	old := retired.Connections[0].Exports[0]
	old.Revision = 2
	retired.Revision = 4
	retired.Connections[0].Exports = append(retired.Connections[0].Exports, old)
	if !errors.Is(second.Update(3, retired, now), ErrStore) {
		t.Fatal("retired grant revived")
	}

}

func TestStoreUsesPrivateFilesAndRejectsLinkedOrWidenedStorage(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows ACL behavior is covered by the native privatefs suite")
	}
	state, _, now := fixtureState(t)
	store, root := newStore(t, state)
	if err := store.Update(0, state, now); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "peer-state", "state.json")
	info, err := os.Stat(file)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("mode", err)
	}
	if err = os.Chmod(file, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Read(); !errors.Is(err, ErrStore) {
		t.Fatal("widened storage accepted")
	}
	if err = os.Chmod(file, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(file, file+".saved"); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(file+".saved", file); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Read(); !errors.Is(err, ErrStore) {
		t.Fatal("linked storage accepted")
	}
}
