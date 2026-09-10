package peer

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNativeDepartureFencesLocallyBeforeOfflineRecoveryWithoutHumanVault(t *testing.T) {
	f, client, store, joined, now := runtimeTLSParticipant(t)
	root := filepath.Dir(store.directory)
	path, tlsBytes := writeNativeTLSFixture(t, root, f)
	human, err := OpenHumanVault(root, store)
	if err != nil {
		t.Fatal(err)
	}
	departures, err := NewDeparture(root, store, client.signer, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	defer departures.Close()
	departures.clock = func() time.Time { return now }
	membershipID := joined.Membership.MembershipID
	connection, err := client.ConnectRuntime(context.Background(), store, membershipID)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if _, err := departures.Synchronize(context.Background(), membershipID); err == nil {
		t.Fatal("recovery initiated a new departure")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	view, err := departures.Prepare(context.Background(), membershipID, "op_nativestopleave001")
	if err != nil || view.LocalState != "left" || view.HostState != "pending" {
		t.Fatal("offline local fence", view, err)
	}
	if err := connection.Heartbeat(context.Background()); err == nil {
		t.Fatal("local departure left Runtime connected")
	}
	if _, err := human.LoadForEntry(membershipID, now); err == nil {
		t.Fatal("local departure retained human entry")
	}
	if _, err := departures.Synchronize(context.Background(), membershipID); !errors.Is(err, ErrTLSConfiguration) {
		t.Fatal("missing TLS configuration did not preserve pending intent", err)
	}
	if counts := f.control(t, map[string]any{"action": "stats"}); counts["departures"] != 0 {
		t.Fatal("local fence required Host access", counts)
	}
	// A crash/reopen preserves both the fence and its one frozen operation.
	departures.Close()
	restoredStore, err := OpenStore(root, client.signer.Identity(), client.signer.LocalUserID())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "peer-human", "state.json"), []byte(`{"broken":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	restored, err := NewDeparture(root, restoredStore, client.signer, func() error { return nil })
	if err != nil {
		t.Fatal("human corruption blocked departure", err)
	}
	defer restored.Close()
	restored.clock = func() time.Time { return now }
	replay, err := restored.Prepare(context.Background(), membershipID, view.Intent.OperationID)
	if err != nil || !equalJSON(view, replay) {
		t.Fatal("reopen lost exact intent", err)
	}
	if _, err := restored.Prepare(context.Background(), membershipID, "op_newintentleave001"); !errors.Is(err, ErrConflict) {
		t.Fatal("departure intent replaced", err)
	}
	if _, err := client.ConnectRuntime(context.Background(), restoredStore, membershipID); err == nil {
		t.Fatal("reopen restored machine rights")
	}
	if err := os.WriteFile(path, tlsBytes, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := restored.Synchronize(context.Background(), membershipID); !errors.Is(err, ErrTransport) {
		t.Fatal("dropped Host response acknowledged", err)
	}
	confirmed, err := restored.Synchronize(context.Background(), membershipID)
	if err != nil || confirmed.HostState != "confirmed" || confirmed.LocalState != "left" {
		t.Fatal("exact Host recovery", err)
	}
	if counts := f.control(t, map[string]any{"action": "stats"}); counts["departures"] != 1 {
		t.Fatal("duplicate Host departure", counts)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if replay, err := restored.Synchronize(context.Background(), membershipID); err != nil || !equalJSON(replay, confirmed) {
		t.Fatal("confirmed departure needed Host access", err)
	}
	views, err := restored.List()
	if err != nil || len(views) != 1 || !equalJSON(views[0], confirmed) {
		t.Fatal("departure status lost", err)
	}
	for _, mutation := range []func(*LocalConnection){
		func(c *LocalConnection) { c.Departure = nil },
		func(c *LocalConnection) { c.State = "active" },
		func(c *LocalConnection) { c.Departure.Intent.OperationID = "op_replacedleave001" },
		func(c *LocalConnection) { c.Departure.Receipt = nil },
		func(c *LocalConnection) { c.Departure.Receipt.Proof.Signature = strings.Repeat("A", 86) },
	} {
		state, err := restoredStore.Read()
		if err != nil {
			t.Fatal(err)
		}
		previous := state.Revision
		state.Revision++
		mutation(&state.Connections[0])
		if err := restoredStore.Update(previous, state, now); err == nil {
			t.Fatal("durable departure authority was rewritten")
		}
	}
	restored.Close()
	if _, err := restored.Prepare(context.Background(), membershipID, view.Intent.OperationID); !errors.Is(err, context.Canceled) {
		t.Fatal("departure survived installation close", err)
	}
}

func TestNativeDepartureConcurrentPrepareKeepsOneOperationAndStateRevision(t *testing.T) {
	_, client, store, joined, now := runtimeTLSParticipant(t)
	departures, err := NewDeparture(filepath.Dir(store.directory), store, client.signer, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	defer departures.Close()
	departures.clock = func() time.Time { return now }
	before, err := store.Read()
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 8)
	for range 8 {
		go func() {
			_, err := departures.Prepare(context.Background(), joined.Membership.MembershipID, "op_concurrentleave001")
			done <- err
		}()
	}
	for range 8 {
		if err := <-done; err != nil {
			t.Fatal("same departure conflicted", err)
		}
	}
	state, err := store.Read()
	if err != nil || state.Revision != before.Revision+1 || state.Connections[0].State != "left" {
		t.Fatal("duplicate local departure", err)
	}
}
