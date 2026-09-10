package peer

import (
	"bytes"
	"crypto/ed25519"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	bridgeruntime "convenewire.dev/bridge/internal/runtime"
	wire "convenewire.dev/contracts/generated/go/peer"
)

func partitionState(t *testing.T) (*Store, string, State, time.Time) {
	t.Helper()
	state, _, now := fixtureState(t)
	// Schema fixtures reuse a public key as a token. Give these storage tests
	// independent machine secrets so disclosure assertions remain meaningful.
	signReceipt := func(local *LocalConnection, operation string) {
		host := wire.PeerNodeIdentity(local.Receipt.Invitation.Host)
		signer := &Signer{identity: host, key: ed25519.NewKeyFromSeed(bytes.Repeat([]byte{7}, 32))}
		local.Receipt.MachineCredential.Token, _ = NewNonce()
		digest, err := JoinReceiptDigest(local.Receipt)
		if err != nil {
			t.Fatal(err)
		}
		nonce, _ := NewNonce()
		local.Receipt.Proof, err = signer.Sign(ProofContext{Purpose: "invitation.claim", AudienceNodeID: state.Participant.NodeID,
			OperationID: operation, Nonce: nonce, SubjectDigest: digest}, now)
		if err != nil {
			t.Fatal(err)
		}
	}
	signReceipt(&state.Connections[0], state.Connections[0].Receipt.Proof.Payload.OperationID)
	store, root := newStore(t, state)
	if err := store.Update(0, state, now); err != nil {
		t.Fatal(err)
	}
	second := cloneState(t, state).Connections[0]
	second.Receipt.Invitation.InvitationID = "peerinvite_partition002"
	second.Receipt.Membership.PeerID, second.Receipt.Membership.MembershipID = "peer_partition002", "peermember_partition002"
	second.Receipt.Membership.MemberID, second.Receipt.Membership.UserID = "member_partition002", "user_partition002"
	second.Receipt.MachineCredential.PeerID = second.Receipt.Membership.PeerID
	second.Receipt.MachineCredential.CredentialID = "peercredential_partition002"
	signReceipt(&second, "op_partitionsecond001")
	state.Revision++
	state.Connections = append(state.Connections, second)
	if err := store.Update(state.Revision-1, state, now); err != nil {
		t.Fatal("second signed membership", err)
	}
	return store, root, state, now
}

func partitionSessionKey() bridgeruntime.RuntimeSessionKey {
	return bridgeruntime.RuntimeSessionKey{RuntimeKind: "pi", RoomID: "room_partition001", TaskID: "task_partition001",
		AgentID: "agent_partition001", WorkspaceFingerprint: strings.Repeat("a", 64), ConfigFingerprint: strings.Repeat("b", 64), SchemaVersion: 2}
}

func TestPeerRuntimePartitionsSeparateSameHostSessionsAndRetainNativePins(t *testing.T) {
	store, root, state, _ := partitionState(t)
	var changed atomic.Bool
	guard := func() error {
		if changed.Load() {
			return ErrStore
		}
		return nil
	}
	partitions, err := NewRuntimePartitions(root, store, guard)
	if err != nil {
		t.Fatal(err)
	}
	first, err := partitions.Open(state.Connections[0].Receipt.Membership.MembershipID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := partitions.Open(state.Connections[1].Receipt.Membership.MembershipID)
	if err != nil {
		t.Fatal(err)
	}
	if first.Namespace() == second.Namespace() || first.DataDir() == second.DataDir() {
		t.Fatal("two Peers shared Runtime partition")
	}
	key := partitionSessionKey()
	if err := first.Sessions().Save(bridgeruntime.RuntimeSessionBinding{RuntimeSessionKey: key, SessionID: "first-peer-session"}); err != nil {
		t.Fatal(err)
	}
	if _, found, err := second.Sessions().Load(key); err != nil || found {
		t.Fatal("second Peer loaded private Session", err)
	}
	device := bridgeruntime.NewFileRuntimeSessionStore(filepath.Join(root, "bridge"))
	if _, found, err := device.Load(key); err != nil || found {
		t.Fatal("Device loaded a Peer Session", err)
	}
	if err := device.Save(bridgeruntime.RuntimeSessionBinding{RuntimeSessionKey: key, SessionID: "device-session"}); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewRuntimePartitions(root, store, guard)
	if err != nil {
		t.Fatal(err)
	}
	retained, err := reopened.Open(first.receipt.MembershipID)
	if err != nil || retained.Namespace() != first.Namespace() {
		t.Fatal("partition identity changed across reopen", err)
	}
	binding, found, err := retained.Sessions().Load(key)
	if err != nil || !found || binding.SessionID != "first-peer-session" {
		t.Fatal("reopen lost private Session", err)
	}
	raw, err := os.ReadFile(filepath.Join(first.DataDir(), "receipt.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range state.Connections {
		if strings.Contains(string(raw), c.Receipt.MachineCredential.Token) {
			t.Fatal("partition copied machine credential")
		}
	}
	changed.Store(true)
	if _, _, err := first.Sessions().Load(key); err == nil {
		t.Fatal("identity change retained Session reads")
	}
	if err := first.Sessions().Save(binding); err == nil {
		t.Fatal("identity change retained Session writes")
	}
	if err := first.Sessions().Delete(key); err == nil {
		t.Fatal("identity change retained Session deletion")
	}
}

func TestPeerRuntimePartitionRejectsMissingCopiedOrLinkedAuthority(t *testing.T) {
	for _, mutation := range []string{"missing marker", "copied marker", "unknown field", "missing directory", "linked sessions"} {
		t.Run(mutation, func(t *testing.T) {
			store, root, state, _ := partitionState(t)
			partitions, err := NewRuntimePartitions(root, store, func() error { return nil })
			if err != nil {
				t.Fatal(err)
			}
			first, err := partitions.Open(state.Connections[0].Receipt.Membership.MembershipID)
			if err != nil {
				t.Fatal(err)
			}
			second, err := partitions.Open(state.Connections[1].Receipt.Membership.MembershipID)
			if err != nil {
				t.Fatal(err)
			}
			marker := filepath.Join(first.DataDir(), "receipt.json")
			switch mutation {
			case "missing marker":
				err = os.Remove(marker)
			case "copied marker":
				raw, readErr := os.ReadFile(filepath.Join(second.DataDir(), "receipt.json"))
				if readErr != nil {
					t.Fatal(readErr)
				}
				err = os.WriteFile(marker, raw, 0600)
			case "unknown field":
				raw, readErr := os.ReadFile(marker)
				if readErr != nil {
					t.Fatal(readErr)
				}
				err = os.WriteFile(marker, append(raw[:len(raw)-1], []byte(`,"deviceId":"device_foreign001"}`)...), 0600)
			case "missing directory":
				err = os.RemoveAll(first.DataDir())
			case "linked sessions":
				err = os.Symlink(second.DataDir(), filepath.Join(first.DataDir(), "runtime-sessions"))
				if err != nil {
					t.Skip("fixture cannot create symlink", err)
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, _, err := first.Sessions().Load(partitionSessionKey()); err == nil {
				t.Fatal("invalid Peer partition accepted")
			}
			if mutation != "linked sessions" {
				if _, err := partitions.Open(first.receipt.MembershipID); err == nil {
					t.Fatal("known partition silently recreated or adopted")
				}
			}
			if err := second.Check(); err != nil {
				t.Fatal("one partition failure blocked another", err)
			}
		})
	}
}
