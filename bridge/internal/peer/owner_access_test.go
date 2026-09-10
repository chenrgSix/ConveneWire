package peer

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	localwire "convenewire.dev/contracts/generated/go/localnode"
	wire "convenewire.dev/contracts/generated/go/peer"
)

func nativeOwnerFixture(t *testing.T, check func() error) (*OwnerAccess, string) {
	t.Helper()
	signer, err := NewLocalSigner(localwire.LocalNodeIdentity{SchemaVersion: 1, NodeID: "node_owneraccess001",
		OwnerUserID: "user_owneraccess001", Port: 40381, Secret: strings.Repeat("A", 43)})
	if err != nil {
		t.Fatal(err)
	}
	store, root := newStore(t, State{Participant: signer.Identity(), LocalUserID: signer.LocalUserID()})
	owner, err := NewOwnerAccess(root, store, signer, check)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Close)
	return owner, root
}

func TestNativeOwnerJoinRefreshesReviewRecoversAndReplaysOffline(t *testing.T) {
	now := time.Date(2026, 9, 10, 2, 0, 0, 0, time.UTC)
	f := peerTLSFixture(t, now)
	owner, root := nativeOwnerFixture(t, func() error { return nil })
	owner.clock = func() time.Time { return now }
	tlsPath, _ := writeNativeTLSFixture(t, root, f)
	input := InvitationInput{Host: f.Host, HostOrigin: f.Origin, InvitationID: f.Invitation.InvitationID,
		Secret: f.Secret, OperationID: "op_ownerreview001"}
	review, err := owner.Preview(context.Background(), input)
	if err != nil || review.Participant != owner.signer.Identity() || review.LocalUserID != owner.signer.LocalUserID() {
		t.Fatal("native review identity", err)
	}
	if pending, err := owner.Pending(); err != nil || len(pending) != 0 {
		t.Fatal("preview persisted join", err)
	}
	state, err := owner.store.Read()
	if err != nil || len(state.Connections) != 0 {
		t.Fatal("preview created membership", err)
	}
	now = now.Add(time.Minute)
	f.control(t, map[string]any{"action": "clock", "now": now.Format(peerTimeFormat)})
	confirmation := JoinConfirmation{InvitationInput: input, DisplayName: "受邀成员", ReviewedInvitationDigest: review.InvitationDigest}
	changed := confirmation
	changed.ReviewedInvitationDigest = strings.Repeat("0", 64)
	if _, err := owner.Confirm(context.Background(), changed); !errors.Is(err, ErrProof) {
		t.Fatal("changed review accepted", err)
	}
	if _, err := owner.Confirm(context.Background(), confirmation); err == nil {
		t.Fatal("dropped claim response confirmed")
	}
	if counts := f.control(t, map[string]any{"action": "stats"}); counts["memberships"] != 1 {
		t.Fatal("refresh did not commit exact join", counts)
	}
	pending, err := owner.Pending()
	if err != nil || len(pending) != 1 {
		t.Fatal("pending recovery lost", err)
	}
	pendingBytes, _ := os.ReadFile(filepath.Join(root, "peer-joins", input.OperationID+".json"))
	viewBytes, _ := json.Marshal(pending)
	if strings.Contains(string(viewBytes), input.Secret) || strings.Contains(string(viewBytes), "previewProof") {
		t.Fatal("pending view disclosed secret")
	}
	// Simulate a native restart, retaining the original frozen operation.
	owner.Close()
	restored, err := NewOwnerAccess(root, owner.store, owner.signer, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(restored.Close)
	restored.clock = func() time.Time { return now }
	outcome, err := restored.Recover(context.Background(), input.OperationID)
	if err != nil || outcome.State != "active" || outcome.Invitation.InvitationID != input.InvitationID {
		t.Fatal("exact recovery", err)
	}
	if pending, err := restored.Pending(); err != nil || len(pending) != 0 {
		t.Fatal("completed secret remains", err)
	}
	state, err = restored.store.Read()
	if err != nil || len(state.Connections) != 1 {
		t.Fatal("duplicate local membership", err)
	}
	human, err := restored.human.LoadForEntry(outcome.Membership.MembershipID, now)
	if err != nil {
		t.Fatal(err)
	}
	markerPath := filepath.Join(root, "peer-joins", "completed", input.OperationID+".json")
	marker, err := os.ReadFile(markerPath)
	if err != nil {
		t.Fatal(err)
	}
	public, _ := json.Marshal([]any{review, pending, outcome, json.RawMessage(marker)})
	for _, secret := range []string{input.Secret, human.HumanCredential.Token, state.Connections[0].Receipt.MachineCredential.Token} {
		if strings.Contains(string(public), secret) {
			t.Fatal("owner response or completion marker disclosed credential")
		}
	}
	entry, err := restored.HumanEntry(context.Background(), outcome.Membership.MembershipID, wire.PeerScope(outcome.Membership.Scope), "op_ownerentry001")
	if err != nil || entry.Credential.Token == human.HumanCredential.Token {
		t.Fatal("independent one-use human entry", err)
	}
	wider := wire.PeerScope(outcome.Membership.Scope)
	wider.Kind, wider.RoomID = "team", nil
	if _, err := restored.HumanEntry(context.Background(), outcome.Membership.MembershipID, wider, "op_ownerwider001"); err == nil {
		t.Fatal("room membership widened")
	}
	// Offline exact replay must use neither fresh Host proof nor a credential.
	if err := os.Remove(tlsPath); err != nil {
		t.Fatal(err)
	}
	replay, err := restored.Confirm(context.Background(), confirmation)
	if err != nil || !equalJSON(replay, outcome) {
		t.Fatal("completed operation required network", err)
	}
	for _, mutate := range []func(*JoinConfirmation){
		func(v *JoinConfirmation) { v.DisplayName += "changed" },
		func(v *JoinConfirmation) { v.Secret = strings.Repeat("B", 43) },
		func(v *JoinConfirmation) { v.HostOrigin = "https://127.0.0.1:40123" },
		func(v *JoinConfirmation) { v.Host.PublicKey = restored.signer.Identity().PublicKey },
		func(v *JoinConfirmation) { v.ReviewedInvitationDigest = strings.Repeat("b", 64) },
	} {
		changed := confirmation
		mutate(&changed)
		if _, err := restored.Confirm(context.Background(), changed); !errors.Is(err, ErrConflict) {
			t.Fatal("completed intent replaced", err)
		}
	}
	// Crash after marker write but before unlink: recovery removes only the same intent.
	if err := os.WriteFile(filepath.Join(root, "peer-joins", input.OperationID+".json"), pendingBytes, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := restored.Recover(context.Background(), input.OperationID); err != nil {
		t.Fatal("marker-before-unlink crash", err)
	}
	if pending, err := restored.Pending(); err != nil || len(pending) != 0 {
		t.Fatal("recovered secret retained", err)
	}
	if err := os.WriteFile(markerPath, append(marker[:len(marker)-1], []byte(`,"unknown":true}`)...), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := restored.Recover(context.Background(), input.OperationID); err == nil {
		t.Fatal("corrupt completion accepted")
	}
	if err := os.WriteFile(markerPath, marker, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(root, "peer-human", "state.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := restored.Recover(context.Background(), input.OperationID); err == nil {
		t.Fatal("completion recreated missing human binding")
	}
}

func TestNativeOwnerSerializesConcurrentConfirmForOneIntent(t *testing.T) {
	now := time.Date(2026, 9, 10, 2, 0, 0, 0, time.UTC)
	f := peerTLSFixture(t, now)
	owner, root := nativeOwnerFixture(t, func() error { return nil })
	owner.clock = func() time.Time { return now }
	writeNativeTLSFixture(t, root, f)
	input := InvitationInput{Host: f.Host, HostOrigin: f.Origin, InvitationID: f.Invitation.InvitationID, Secret: f.Secret, OperationID: "op_ownerparallel001"}
	review, err := owner.Preview(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	confirmation := JoinConfirmation{InvitationInput: input, DisplayName: "Owner", ReviewedInvitationDigest: review.InvitationDigest}
	done := make(chan error, 4)
	for range 4 {
		go func() { _, err := owner.Confirm(context.Background(), confirmation); done <- err }()
	}
	var successes int
	for range 4 {
		if err := <-done; err == nil {
			successes++
		} else if !errors.Is(err, ErrTransport) {
			t.Fatal("parallel intent conflict", err)
		}
	}
	if successes != 3 {
		t.Fatal("expected one dropped response and three exact recoveries", successes)
	}
	if counts := f.control(t, map[string]any{"action": "stats"}); counts["memberships"] != 1 {
		t.Fatal("concurrent duplicate membership", counts)
	}
}

func TestNativeOwnerCloseCancelsAndDrainsQueuedOperations(t *testing.T) {
	owner, _ := nativeOwnerFixture(t, func() error { return nil })
	ctx, end, err := owner.begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	entered, release, running := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() {
		defer close(running)
		defer end()
		_, _ = owner.join(ctx, "op_closeowner001", func() (JoinOutcome, error) {
			close(entered)
			<-ctx.Done()
			<-release
			return JoinOutcome{}, ctx.Err()
		})
	}()
	<-entered
	queued, queuedEnd, err := owner.begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var executed atomic.Bool
	queueDone := make(chan error, 1)
	go func() {
		defer queuedEnd()
		_, err := owner.join(queued, "op_closeowner001", func() (JoinOutcome, error) { executed.Store(true); return JoinOutcome{}, nil })
		queueDone <- err
	}()
	closed := make(chan struct{})
	go func() { owner.Close(); close(closed) }()
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("close did not cancel active operation")
	}
	select {
	case <-closed:
		t.Fatal("close released lifetime before active work drained")
	default:
	}
	select {
	case err := <-queueDone:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("queued operation did not cancel")
	}
	close(release)
	<-running
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("close did not finish")
	}
	if executed.Load() {
		t.Fatal("queued operation executed after close")
	}
	if _, err := owner.Recover(context.Background(), "op_closeowner001"); !errors.Is(err, context.Canceled) {
		t.Fatal("closed owner accepted recovery", err)
	}
}
