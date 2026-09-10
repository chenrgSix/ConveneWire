package peer

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

type InvitationInput struct {
	Host         wire.PeerNodeIdentity `json:"host"`
	HostOrigin   string                `json:"hostOrigin"`
	InvitationID string                `json:"invitationId"`
	Secret       string                `json:"secret"`
	OperationID  string                `json:"operationId"`
}
type JoinReview struct {
	OperationID      string                `json:"operationId"`
	Participant      wire.PeerNodeIdentity `json:"participant"`
	LocalUserID      string                `json:"localUserId"`
	Invitation       wire.PeerInvitation   `json:"invitation"`
	InvitationDigest string                `json:"invitationDigest"`
}
type JoinConfirmation struct {
	InvitationInput
	DisplayName              string `json:"displayName"`
	ReviewedInvitationDigest string `json:"reviewedInvitationDigest"`
}
type JoinOutcome struct {
	OperationID string              `json:"operationId"`
	Invitation  wire.PeerInvitation `json:"invitation"`
	Membership  wire.PeerMembership `json:"membership"`
	State       string              `json:"state"`
}
type PendingJoinView struct {
	OperationID string              `json:"operationId"`
	Invitation  wire.PeerInvitation `json:"invitation"`
	DisplayName string              `json:"displayName"`
	CreatedAt   string              `json:"createdAt"`
}

type OwnerOperations interface {
	Preview(context.Context, InvitationInput) (JoinReview, error)
	Confirm(context.Context, JoinConfirmation) (JoinOutcome, error)
	Recover(context.Context, string) (JoinOutcome, error)
	Pending() ([]PendingJoinView, error)
	HumanEntry(context.Context, string, wire.PeerScope, string) (HumanEntry, error)
}

// OwnerAccess is provided only to authenticated native Console actions.
// Runtime connectors never receive this object or its separate human vault.
type OwnerAccess struct {
	*ownerLifetime
	root    string
	store   *Store
	signer  *Signer
	human   *HumanVault
	journal *JoinJournal
	clock   func() time.Time
	joins   map[string]*ownerJoinOperation
}

type ownerJoinOperation struct {
	gate       chan struct{}
	references int
}

func NewOwnerAccess(root string, store *Store, signer *Signer, checkIdentity func() error) (*OwnerAccess, error) {
	if store == nil || signer == nil || root != filepath.Dir(store.directory) || checkIdentity == nil || checkIdentity() != nil {
		return nil, ErrStore
	}
	state, err := store.Read()
	if err != nil || state.Participant != signer.Identity() || state.LocalUserID != signer.LocalUserID() {
		return nil, ErrStore
	}
	human, err := OpenHumanVault(root, store)
	if err != nil {
		return nil, err
	}
	journal, err := OpenJoinJournal(store, human)
	if err != nil {
		return nil, err
	}
	return &OwnerAccess{ownerLifetime: newOwnerLifetime(checkIdentity), root: root, store: store, signer: signer,
		human: human, journal: journal, clock: time.Now, joins: map[string]*ownerJoinOperation{}}, nil
}

func (o *OwnerAccess) join(ctx context.Context, id string, action func() (JoinOutcome, error)) (JoinOutcome, error) {
	if !peerOperationID.MatchString(id) {
		return JoinOutcome{}, ErrProof
	}
	o.mu.Lock()
	op := o.joins[id]
	if op == nil {
		if len(o.joins) >= 64 {
			o.mu.Unlock()
			return JoinOutcome{}, ErrConflict
		}
		op = &ownerJoinOperation{gate: make(chan struct{}, 1)}
		o.joins[id] = op
	}
	if op.references >= 64 {
		o.mu.Unlock()
		return JoinOutcome{}, ErrConflict
	}
	op.references++
	o.mu.Unlock()
	defer func() {
		o.mu.Lock()
		op.references--
		if op.references == 0 {
			delete(o.joins, id)
		}
		o.mu.Unlock()
	}()
	select {
	case <-ctx.Done():
		return JoinOutcome{}, ctx.Err()
	case op.gate <- struct{}{}:
	}
	defer func() { <-op.gate }()
	if err := ctx.Err(); err != nil {
		return JoinOutcome{}, err
	}
	return action()
}

func (o *OwnerAccess) client(origin string, host wire.PeerNodeIdentity) (*Client, error) {
	client, err := NewNativeClient(o.root, origin, host, o.signer, o.check)
	if err == nil {
		client.clock = o.clock
	}
	return client, err
}

func (o *OwnerAccess) Preview(ctx context.Context, input InvitationInput) (JoinReview, error) {
	ctx, done, err := o.begin(ctx)
	if err != nil {
		return JoinReview{}, err
	}
	defer done()
	client, err := o.client(input.HostOrigin, input.Host)
	if err != nil {
		return JoinReview{}, err
	}
	defer client.Close()
	preview, err := client.Preview(ctx, input.InvitationID, input.Secret, input.OperationID)
	if err != nil {
		return JoinReview{}, err
	}
	digest, err := semanticDigest(preview.Invitation)
	return JoinReview{OperationID: input.OperationID, Participant: o.signer.Identity(), LocalUserID: o.signer.LocalUserID(),
		Invitation: preview.Invitation, InvitationDigest: digest}, err
}

func (o *OwnerAccess) Confirm(ctx context.Context, input JoinConfirmation) (JoinOutcome, error) {
	ctx, done, err := o.begin(ctx)
	if err != nil {
		return JoinOutcome{}, err
	}
	defer done()
	return o.join(ctx, input.OperationID, func() (JoinOutcome, error) { return o.confirm(ctx, input) })
}

func (o *OwnerAccess) confirm(ctx context.Context, input JoinConfirmation) (JoinOutcome, error) {
	if o.check() != nil || !joinDigest.MatchString(input.ReviewedInvitationDigest) {
		return JoinOutcome{}, ErrProof
	}
	intent, err := joinOwnerIntentDigest(input.Host, input.HostOrigin, input.InvitationID, input.ReviewedInvitationDigest,
		o.signer.Identity(), o.signer.LocalUserID(), input.DisplayName, input.Secret, input.OperationID)
	if err != nil {
		return JoinOutcome{}, err
	}
	completed, local, found, err := o.journal.completion(input.OperationID)
	if err != nil {
		return JoinOutcome{}, err
	}
	if found {
		if completed.IntentDigest != intent {
			return JoinOutcome{}, ErrConflict
		}
		return ownerJoinOutcome(input.OperationID, local, o.clock()), nil
	}
	pending, err := o.journal.Load(input.OperationID)
	if err == nil {
		prior, err := joinOwnerIntent(pending.Invitation, pending.Participant, pending.LocalUserID, pending.DisplayName, pending.Secret, pending.OperationID)
		if err != nil || prior != intent {
			return JoinOutcome{}, ErrConflict
		}
		return o.recover(ctx, input.OperationID)
	}
	if !errors.Is(err, os.ErrNotExist) {
		return JoinOutcome{}, err
	}
	client, err := o.client(input.HostOrigin, input.Host)
	if err != nil {
		return JoinOutcome{}, err
	}
	defer client.Close()
	// Human review may outlive the 30-second transport proof. Refresh that proof
	// at confirmation, but require the exact invitation contents already reviewed.
	preview, err := client.Preview(ctx, input.InvitationID, input.Secret, input.OperationID)
	if err != nil {
		return JoinOutcome{}, err
	}
	digest, err := semanticDigest(preview.Invitation)
	if err != nil || digest != input.ReviewedInvitationDigest {
		return JoinOutcome{}, ErrProof
	}
	now := o.clock()
	pending = PendingJoin{SchemaVersion: 1, Participant: o.signer.Identity(), LocalUserID: o.signer.LocalUserID(), Invitation: preview.Invitation,
		Secret: input.Secret, OperationID: input.OperationID, DisplayName: input.DisplayName, PreviewProof: preview.Proof, CreatedAt: now.UTC().Format(peerTimeFormat)}
	if err := o.journal.Save(pending, now); err != nil {
		return JoinOutcome{}, err
	}
	if _, err := client.ClaimPending(ctx, o.journal, input.OperationID); err != nil {
		return JoinOutcome{}, err
	}
	return o.completed(input.OperationID)
}

func (o *OwnerAccess) completed(operationID string) (JoinOutcome, error) {
	_, local, found, err := o.journal.completion(operationID)
	if err != nil || !found {
		return JoinOutcome{}, ErrStore
	}
	return ownerJoinOutcome(operationID, local, o.clock()), nil
}

func (o *OwnerAccess) Recover(ctx context.Context, operationID string) (JoinOutcome, error) {
	ctx, done, err := o.begin(ctx)
	if err != nil {
		return JoinOutcome{}, err
	}
	defer done()
	return o.join(ctx, operationID, func() (JoinOutcome, error) { return o.recover(ctx, operationID) })
}

func (o *OwnerAccess) recover(ctx context.Context, operationID string) (JoinOutcome, error) {
	if err := o.check(); err != nil {
		return JoinOutcome{}, err
	}
	_, local, found, err := o.journal.completion(operationID)
	if err != nil {
		return JoinOutcome{}, err
	}
	if found {
		return ownerJoinOutcome(operationID, local, o.clock()), nil
	}
	pending, err := o.journal.Load(operationID)
	if err != nil {
		return JoinOutcome{}, err
	}
	client, err := o.client(pending.Invitation.HostOrigin, wire.PeerNodeIdentity(pending.Invitation.Host))
	if err != nil {
		return JoinOutcome{}, err
	}
	defer client.Close()
	if _, err := client.ClaimPending(ctx, o.journal, operationID); err != nil {
		return JoinOutcome{}, err
	}
	return o.completed(operationID)
}

func ownerJoinOutcome(operationID string, local LocalConnection, now time.Time) JoinOutcome {
	state := local.State
	if state == "active" && !after(local.Receipt.Membership.ExpiresAt, now) {
		state = "expired"
	}
	return JoinOutcome{OperationID: operationID, Invitation: local.Receipt.Invitation, Membership: local.Receipt.Membership, State: state}
}

func (o *OwnerAccess) Pending() ([]PendingJoinView, error) {
	if err := o.check(); err != nil {
		return nil, err
	}
	pending, err := o.journal.Pending()
	if err != nil {
		return nil, err
	}
	views := []PendingJoinView{}
	for _, p := range pending {
		views = append(views, PendingJoinView{OperationID: p.OperationID, Invitation: p.Invitation, DisplayName: p.DisplayName, CreatedAt: p.CreatedAt})
	}
	return views, nil
}

func (o *OwnerAccess) HumanEntry(ctx context.Context, membershipID string, scope wire.PeerScope, operationID string) (HumanEntry, error) {
	ctx, done, err := o.begin(ctx)
	if err != nil {
		return HumanEntry{}, err
	}
	defer done()
	state, err := o.store.Read()
	if err != nil {
		return HumanEntry{}, err
	}
	local, found := findConnection(state, membershipID)
	if !found {
		return HumanEntry{}, ErrStore
	}
	client, err := o.client(local.Receipt.Invitation.HostOrigin, wire.PeerNodeIdentity(local.Receipt.Invitation.Host))
	if err != nil {
		return HumanEntry{}, err
	}
	defer client.Close()
	return client.HumanEntry(ctx, o.human, membershipID, scope, operationID)
}
