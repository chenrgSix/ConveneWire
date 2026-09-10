package peer

import (
	"context"
	"errors"
	"path/filepath"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

type LocalDeparture struct {
	Intent    LeaveIntent   `json:"intent"`
	CreatedAt string        `json:"createdAt"`
	Receipt   *LeaveReceipt `json:"receipt,omitempty"`
}

type DepartureView struct {
	Intent     LeaveIntent `json:"intent"`
	LocalState string      `json:"localState"`
	HostState  string      `json:"hostState"`
	RecordedAt string      `json:"recordedAt,omitempty"`
}

type DepartureOperations interface {
	Prepare(context.Context, string, string) (DepartureView, error)
	Synchronize(context.Context, string) (DepartureView, error)
	List() ([]DepartureView, error)
}

type Departure struct {
	*ownerLifetime
	root   string
	store  *Store
	signer *Signer
	clock  func() time.Time
}

func NewDeparture(root string, store *Store, signer *Signer, checkIdentity func() error) (*Departure, error) {
	if store == nil || signer == nil || root != filepath.Dir(store.directory) || checkIdentity == nil || checkIdentity() != nil {
		return nil, ErrStore
	}
	state, err := store.Read()
	if err != nil || state.Participant != signer.Identity() || state.LocalUserID != signer.LocalUserID() {
		return nil, ErrStore
	}
	return &Departure{ownerLifetime: newOwnerLifetime(checkIdentity), root: root, store: store, signer: signer, clock: time.Now}, nil
}

func leaveIntent(connection LocalConnection, participant wire.PeerNodeIdentity, operationID string) LeaveIntent {
	return LeaveIntent{SchemaVersion: 1, OperationID: operationID, Host: wire.PeerNodeIdentity(connection.Receipt.Invitation.Host),
		HostOrigin: connection.Receipt.Invitation.HostOrigin, Participant: participant, PeerID: connection.Receipt.Membership.PeerID,
		MembershipID: connection.Receipt.Membership.MembershipID}
}

func departureView(connection LocalConnection) DepartureView {
	d := connection.Departure
	view := DepartureView{Intent: d.Intent, LocalState: connection.State, HostState: "pending"}
	if d.Receipt != nil {
		view.HostState, view.RecordedAt = "confirmed", d.Receipt.RecordedAt
	}
	return view
}

// The local fence and frozen operation share one CAS write. No TLS, human vault,
// Runtime configuration or live connector is needed to stop local access.
func (d *Departure) Prepare(ctx context.Context, membershipID, operationID string) (DepartureView, error) {
	ctx, done, err := d.begin(ctx)
	if err != nil {
		return DepartureView{}, err
	}
	defer done()
	if !peerOperationID.MatchString(operationID) {
		return DepartureView{}, ErrProof
	}
	for range 8 {
		if err := ctx.Err(); err != nil {
			return DepartureView{}, err
		}
		state, err := d.store.Read()
		if err != nil {
			return DepartureView{}, err
		}
		index, local, found := exportConnection(state, membershipID)
		if !found {
			return DepartureView{}, ErrStore
		}
		intent := leaveIntent(local, d.signer.Identity(), operationID)
		if local.Departure != nil {
			if !equalJSON(local.Departure.Intent, intent) {
				return DepartureView{}, ErrConflict
			}
			return departureView(local), nil
		}
		if local.State == "active" {
			local.State = "left"
		}
		now := d.clock()
		local.Departure = &LocalDeparture{Intent: intent, CreatedAt: now.UTC().Format(peerTimeFormat)}
		state.Connections[index] = local
		previous := state.Revision
		state.Revision++
		if err := d.store.Update(previous, state, now); errors.Is(err, ErrConflict) {
			continue
		} else if err != nil {
			return DepartureView{}, err
		}
		return departureView(local), nil
	}
	return DepartureView{}, ErrConflict
}

// Recovery can only synchronize an already durable local departure. A stored
// confirmation is returned offline; a new operation can never replace it.
func (d *Departure) Synchronize(ctx context.Context, membershipID string) (DepartureView, error) {
	ctx, done, err := d.begin(ctx)
	if err != nil {
		return DepartureView{}, err
	}
	defer done()
	state, err := d.store.Read()
	if err != nil {
		return DepartureView{}, err
	}
	_, local, found := exportConnection(state, membershipID)
	if !found || local.Departure == nil {
		return DepartureView{}, ErrStore
	}
	if local.Departure.Receipt != nil {
		return departureView(local), nil
	}
	intent := local.Departure.Intent
	client, err := NewNativeClient(d.root, intent.HostOrigin, intent.Host, d.signer, d.check)
	if err != nil {
		return DepartureView{}, err
	}
	defer client.Close()
	client.clock = d.clock
	receipt, err := client.Leave(ctx, intent)
	if err != nil {
		return DepartureView{}, err
	}
	for range 8 {
		if err := ctx.Err(); err != nil {
			return DepartureView{}, err
		}
		state, err := d.store.Read()
		if err != nil {
			return DepartureView{}, err
		}
		index, local, found := exportConnection(state, membershipID)
		if !found || local.Departure == nil || !equalJSON(local.Departure.Intent, intent) {
			return DepartureView{}, ErrConflict
		}
		if local.Departure.Receipt != nil {
			return departureView(local), nil
		}
		local.Departure.Receipt = &receipt
		state.Connections[index] = local
		previous := state.Revision
		state.Revision++
		if err := d.store.Update(previous, state, d.clock()); errors.Is(err, ErrConflict) {
			continue
		} else if err != nil {
			return DepartureView{}, err
		}
		return departureView(local), nil
	}
	return DepartureView{}, ErrConflict
}

func (d *Departure) List() ([]DepartureView, error) {
	_, done, err := d.begin(context.Background())
	if err != nil {
		return nil, err
	}
	defer done()
	state, err := d.store.Read()
	if err != nil {
		return nil, err
	}
	views := []DepartureView{}
	for _, local := range state.Connections {
		if local.Departure != nil {
			views = append(views, departureView(local))
		}
	}
	return views, nil
}

func validateDeparture(local LocalConnection, participant wire.PeerNodeIdentity, operations map[string]bool) error {
	d := local.Departure
	if d == nil {
		return nil
	}
	if local.State == "active" || !closed("PeerLocalDeparture", d) || operations[d.Intent.OperationID] ||
		!equalJSON(d.Intent, leaveIntent(local, participant, d.Intent.OperationID)) {
		return ErrStore
	}
	operations[d.Intent.OperationID] = true
	if d.Receipt != nil {
		issued, err := time.Parse(time.RFC3339Nano, d.Receipt.Proof.Payload.IssuedAt)
		if err != nil || VerifyLeaveReceipt(*d.Receipt, d.Intent, d.Receipt.Proof.Payload.Nonce, issued) != nil {
			return ErrStore
		}
	}
	return nil
}

func departureTransition(old, next LocalConnection, now time.Time) error {
	prior, current := old.Departure, next.Departure
	if current == nil {
		if prior != nil {
			return ErrStore
		}
		return nil
	}
	if prior == nil {
		created, err := time.Parse(time.RFC3339Nano, current.CreatedAt)
		if err != nil || created.After(now) || current.Receipt != nil {
			return ErrStore
		}
		return nil
	}
	if !equalJSON(prior.Intent, current.Intent) || prior.CreatedAt != current.CreatedAt {
		return ErrStore
	}
	if prior.Receipt != nil {
		if !equalJSON(prior.Receipt, current.Receipt) {
			return ErrStore
		}
		return nil
	}
	if current.Receipt != nil && VerifyLeaveReceipt(*current.Receipt, current.Intent, current.Receipt.Proof.Payload.Nonce, now) != nil {
		return ErrStore
	}
	return nil
}
