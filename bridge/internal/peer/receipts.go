package peer

import (
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

// HumanReceipt never enters the Runtime store or connector configuration.
type HumanReceipt struct {
	SchemaVersion     int64                           `json:"schemaVersion"`
	Host              wire.PeerNodeIdentity           `json:"host"`
	Participant       wire.PeerNodeIdentity           `json:"participant"`
	LocalUserID       string                          `json:"localUserId"`
	JoinReceiptDigest string                          `json:"joinReceiptDigest"`
	HumanCredential   wire.PeerHumanBindingCredential `json:"humanCredential"`
	Proof             wire.PeerProof                  `json:"proof"`
}
type Joined struct {
	SchemaVersion int64        `json:"schemaVersion"`
	Runtime       JoinReceipt  `json:"runtime"`
	Human         HumanReceipt `json:"human"`
}
type InvitationPreview struct {
	SchemaVersion int64               `json:"schemaVersion"`
	Invitation    wire.PeerInvitation `json:"invitation"`
	Proof         wire.PeerProof      `json:"proof"`
}
type HumanEntry struct {
	SchemaVersion     int64                    `json:"schemaVersion"`
	Credential        wire.PeerHumanCredential `json:"credential"`
	ExchangeExpiresAt string                   `json:"exchangeExpiresAt"`
	HostOrigin        string                   `json:"hostOrigin"`
	Proof             wire.PeerProof           `json:"proof"`
}

func HumanReceiptDigest(receipt HumanReceipt) (string, error) {
	return semanticDigest(map[string]any{"host": receipt.Host, "participant": receipt.Participant, "localUserId": receipt.LocalUserID,
		"joinReceiptDigest": receipt.JoinReceiptDigest, "humanCredential": receipt.HumanCredential})
}
func HumanEntryDigest(entry HumanEntry) (string, error) {
	return semanticDigest(map[string]any{"credential": entry.Credential, "exchangeExpiresAt": entry.ExchangeExpiresAt, "hostOrigin": entry.HostOrigin})
}

// VerifyInvitationPreview checks the invitation link's trusted identity and origin,
// independent of the TLS connection. Only a verified preview may be shown for Owner approval.
func VerifyInvitationPreview(preview InvitationPreview, host, participant wire.PeerNodeIdentity, origin, invitationID, operationID, nonce string, now time.Time) error {
	if !closed("PeerInvitationPreview", preview) || ValidateOrigin(origin) != nil || preview.Invitation.HostOrigin != origin ||
		!equalJSON(preview.Invitation.Host, host) || host.NodeID == participant.NodeID || preview.Invitation.InvitationID != invitationID {
		return ErrProof
	}
	expires, err := time.Parse(time.RFC3339Nano, preview.Invitation.ExpiresAt)
	if err != nil || !expires.After(now) || !after(preview.Invitation.MembershipExpiresAt, now) {
		return ErrProof
	}
	digest, err := semanticDigest(preview.Invitation)
	if err != nil {
		return ErrProof
	}
	return VerifyProof(preview.Proof, host, ProofContext{Purpose: "invitation.preview", AudienceNodeID: participant.NodeID, OperationID: operationID, Nonce: nonce, SubjectDigest: digest}, now)
}

func VerifyJoined(joined Joined, approved wire.PeerInvitation, participant wire.PeerNodeIdentity, localUserID, operationID, nonce string, now time.Time) error {
	if !closed("PeerJoined", joined) || !equalJSON(joined.Runtime.Invitation, approved) ||
		!after(joined.Runtime.Membership.ExpiresAt, now) || !after(joined.Runtime.MachineCredential.ExpiresAt, now) {
		return ErrProof
	}
	state := State{SchemaVersion: 1, Participant: participant, LocalUserID: localUserID, Revision: 1, Connections: []LocalConnection{
		{Receipt: joined.Runtime, State: "active", Exports: []wire.AgentExportGrant{}, Acceptances: []wire.RemoteAgentAcceptance{}},
	}}
	if validateState(state, participant, localUserID) != nil {
		return ErrProof
	}
	digest, err := JoinReceiptDigest(joined.Runtime)
	if err != nil {
		return ErrProof
	}
	host := wire.PeerNodeIdentity{NodeID: approved.Host.NodeID, PublicKey: approved.Host.PublicKey}
	context := ProofContext{Purpose: "invitation.claim", AudienceNodeID: participant.NodeID, OperationID: operationID, Nonce: nonce, SubjectDigest: digest}
	if VerifyProof(joined.Runtime.Proof, host, context, now) != nil || validateHumanReceipt(joined.Human, joined.Runtime, participant, localUserID) != nil {
		return ErrProof
	}
	context.SubjectDigest, err = HumanReceiptDigest(joined.Human)
	if err != nil || !after(joined.Human.HumanCredential.ExpiresAt, now) {
		return ErrProof
	}
	return VerifyProof(joined.Human.Proof, host, context, now)
}

// Historical reads verify the original proof at its issuance time. Live entry
// requests independently recheck Membership and the human binding at the Host.
func validateHumanReceipt(human HumanReceipt, runtime JoinReceipt, participant wire.PeerNodeIdentity, localUserID string) error {
	if !closed("PeerHumanBindingReceipt", human) || !equalJSON(human.Host, runtime.Invitation.Host) || human.Participant != participant ||
		human.LocalUserID != localUserID || localUserID != runtime.Membership.LocalUserID || participant.NodeID != runtime.Membership.ParticipantNodeID ||
		human.Proof.Payload.OperationID != runtime.Proof.Payload.OperationID || human.HumanCredential.MembershipID != runtime.Membership.MembershipID ||
		!equalJSON(human.HumanCredential.Scope, runtime.Membership.Scope) || human.HumanCredential.ExpiresAt > runtime.Membership.ExpiresAt ||
		human.HumanCredential.ExpiresAt <= runtime.Membership.CreatedAt || human.HumanCredential.Token == runtime.MachineCredential.Token {
		return ErrProof
	}
	digest, err := JoinReceiptDigest(runtime)
	if err != nil || human.JoinReceiptDigest != digest {
		return ErrProof
	}
	digest, err = HumanReceiptDigest(human)
	if err != nil {
		return ErrProof
	}
	at, err := time.Parse(time.RFC3339Nano, human.Proof.Payload.IssuedAt)
	if err != nil {
		return ErrProof
	}
	return VerifyProof(human.Proof, human.Host, ProofContext{Purpose: "invitation.claim", AudienceNodeID: participant.NodeID,
		OperationID: human.Proof.Payload.OperationID, Nonce: human.Proof.Payload.Nonce, SubjectDigest: digest}, at)
}

func VerifyHumanEntry(entry HumanEntry, human HumanReceipt, runtime JoinReceipt, requested wire.PeerScope, operationID, nonce string, now time.Time) error {
	if !closed("PeerHumanEntry", entry) || validateHumanReceipt(human, runtime, human.Participant, human.LocalUserID) != nil ||
		entry.HostOrigin != runtime.Invitation.HostOrigin || ValidateOrigin(entry.HostOrigin) != nil ||
		entry.Credential.MembershipID != human.HumanCredential.MembershipID || !equalJSON(entry.Credential.Scope, requested) ||
		entry.Credential.Token == human.HumanCredential.Token || entry.Credential.Token == runtime.MachineCredential.Token ||
		!scopeWithin(requested, wire.PeerScope(human.HumanCredential.Scope)) ||
		entry.Credential.ExpiresAt > human.HumanCredential.ExpiresAt || entry.Credential.ExpiresAt > runtime.Membership.ExpiresAt ||
		entry.ExchangeExpiresAt > entry.Credential.ExpiresAt || !after(entry.ExchangeExpiresAt, now) || !after(entry.Credential.ExpiresAt, now) {
		return ErrProof
	}
	issued, err := time.Parse(time.RFC3339Nano, entry.Proof.Payload.IssuedAt)
	if err != nil {
		return ErrProof
	}
	exchange, _ := time.Parse(time.RFC3339Nano, entry.ExchangeExpiresAt)
	expiry, _ := time.Parse(time.RFC3339Nano, entry.Credential.ExpiresAt)
	if exchange.After(issued.Add(time.Minute)) || expiry.After(issued.Add(8*time.Hour)) {
		return ErrProof
	}
	digest, err := HumanEntryDigest(entry)
	if err != nil {
		return ErrProof
	}
	return VerifyProof(entry.Proof, human.Host, ProofContext{Purpose: "human.entry", AudienceNodeID: human.Participant.NodeID,
		OperationID: operationID, Nonce: nonce, SubjectDigest: digest}, now)
}
func scopeWithin(scope, ceiling wire.PeerScope) bool {
	return closed("PeerScope", scope) && scope.TeamID == ceiling.TeamID &&
		(ceiling.Kind == "team" || (scope.Kind == "room" && scope.RoomID != nil && ceiling.RoomID != nil && *scope.RoomID == *ceiling.RoomID))
}
func after(timestamp string, now time.Time) bool {
	parsed, err := time.Parse(time.RFC3339Nano, timestamp)
	return err == nil && parsed.After(now)
}
