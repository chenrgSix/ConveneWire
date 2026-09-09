package peer

import (
	"errors"
	"strings"
	"time"

	"convenewire.dev/bridge/internal/config"
	wire "convenewire.dev/contracts/generated/go/peer"
)

var ErrExport = errors.New("Peer export requires current explicit local authorization")

type AgentOffer struct {
	SchemaVersion int64                 `json:"schemaVersion"`
	Grant         wire.AgentExportGrant `json:"grant"`
	DisplayName   string                `json:"displayName"`
	Role          string                `json:"role"`
}
type LocalExport struct {
	SchemaVersion       int64      `json:"schemaVersion"`
	OperationID         string     `json:"operationId"`
	IntentDigest        string     `json:"intentDigest"`
	ConfigurationDigest string     `json:"configurationDigest"`
	Offer               AgentOffer `json:"offer"`
}

// ResolveExportSource is supplied by the owning core's stable local Agent map.
// It must resolve the actual current configuration and adapter capabilities;
// network input cannot supply a source or create a local Agent.
type ExportSource struct {
	AgentID       string                `json:"agentId"`
	Configuration config.AgentConfig    `json:"configuration"`
	Capabilities  wire.PeerCapabilities `json:"capabilities"`
}
type ResolveExportSource func(localAgentID string) (ExportSource, error)
type Exporter struct {
	store   *Store
	resolve ResolveExportSource
}
type ExportRequest struct {
	MembershipID   string                `json:"membershipId"`
	LocalAgentID   string                `json:"localAgentId"`
	OperationID    string                `json:"operationId"`
	RoomIDs        []string              `json:"roomIds"`
	Capabilities   wire.PeerCapabilities `json:"capabilities"`
	ExpiresAt      string                `json:"expiresAt"`
	ReplaceLineage bool                  `json:"replaceLineage"`
}

func NewExporter(store *Store, resolve ResolveExportSource) (*Exporter, error) {
	if store == nil || resolve == nil {
		return nil, ErrExport
	}
	return &Exporter{store: store, resolve: resolve}, nil
}

// Prepare is an explicit local Owner action. Persist the complete reviewed
// intent and grant together before any network attempt can use either.
func (e *Exporter) Prepare(expected int64, request ExportRequest, now time.Time) (LocalExport, error) {
	source, err := e.resolve(request.LocalAgentID)
	if err != nil || source.AgentID != request.LocalAgentID || validExportSource(source) != nil ||
		!capabilitySubset(request.Capabilities, source.Capabilities) {
		return LocalExport{}, ErrExport
	}
	configuration, err := semanticDigest(source)
	if err != nil {
		return LocalExport{}, ErrExport
	}
	intent, err := semanticDigest(map[string]any{"kind": "export", "request": request, "configurationDigest": configuration})
	if err != nil {
		return LocalExport{}, ErrExport
	}
	state, err := e.store.Read()
	if err != nil {
		return LocalExport{}, err
	}
	if old, found := localOperation(state, request.OperationID); found {
		if old.IntentDigest != intent {
			return LocalExport{}, ErrConflict
		}
		return old, nil
	}
	index, connection, ok := exportConnection(state, request.MembershipID)
	if !ok || connection.State != "active" || !after(connection.Receipt.Membership.ExpiresAt, now) ||
		!after(request.ExpiresAt, now) || request.ExpiresAt > connection.Receipt.Membership.ExpiresAt ||
		!roomsWithinMembership(request.RoomIDs, connection.Receipt.Membership) || len(connection.LocalExports) >= 1024 {
		return LocalExport{}, ErrExport
	}
	previous, found := currentLocalGrant(connection, request.LocalAgentID)
	if found && previous.State == "revoked" && !request.ReplaceLineage {
		return LocalExport{}, ErrExport
	}
	grant := wire.AgentExportGrant{SchemaVersion: 1, LocalAgentID: request.LocalAgentID, PeerID: connection.Receipt.Membership.PeerID,
		AuthorityNodeID: connection.Receipt.Membership.HostNodeID, ParticipantNodeID: state.Participant.NodeID,
		TeamID: connection.Receipt.Membership.Scope.TeamID, RoomIDS: append([]string{}, request.RoomIDs...),
		Capabilities: wire.AgentExportGrantCapabilities(request.Capabilities), ExpiresAt: request.ExpiresAt,
		IssuedAt: now.UTC().Format(peerTimeFormat), State: "active", Revision: 1}
	if found && !request.ReplaceLineage {
		grant.ExportID, grant.Revision = previous.ExportID, previous.Revision+1
	} else {
		nonce, err := NewNonce()
		if err != nil {
			return LocalExport{}, err
		}
		grant.ExportID = "export_" + nonce
	}
	entry := LocalExport{SchemaVersion: 1, OperationID: request.OperationID, IntentDigest: intent, ConfigurationDigest: configuration,
		Offer: AgentOffer{SchemaVersion: 1, Grant: grant, DisplayName: source.Configuration.Name, Role: source.Configuration.Role}}
	if !closed("PeerLocalExport", entry) {
		return LocalExport{}, ErrExport
	}
	state.Connections[index].Exports = append(state.Connections[index].Exports, grant)
	state.Connections[index].LocalExports = append(state.Connections[index].LocalExports, entry)
	state.Revision++
	if err = e.store.Update(expected, state, now); err != nil {
		return LocalExport{}, err
	}
	return entry, nil
}

// Withdraw remains possible when the Runtime is removed or changed, the Host is
// offline, or membership has ended. It never needs a network acknowledgment.
func (e *Exporter) Withdraw(expected int64, membershipID, exportID string, grantRevision int64, operationID string, now time.Time) (LocalExport, error) {
	intent, err := semanticDigest(map[string]any{"kind": "revoke", "membershipId": membershipID,
		"exportId": exportID, "grantRevision": grantRevision, "operationId": operationID})
	if err != nil {
		return LocalExport{}, err
	}
	state, err := e.store.Read()
	if err != nil {
		return LocalExport{}, err
	}
	if old, found := localOperation(state, operationID); found {
		if old.IntentDigest != intent {
			return LocalExport{}, ErrConflict
		}
		return old, nil
	}
	index, connection, ok := exportConnection(state, membershipID)
	if !ok {
		return LocalExport{}, ErrExport
	}
	var previous LocalExport
	for _, entry := range connection.LocalExports {
		if entry.Offer.Grant.ExportID == exportID {
			previous = entry
		}
	}
	if previous.SchemaVersion != 1 || previous.Offer.Grant.Revision != grantRevision || previous.Offer.Grant.State != "active" {
		return LocalExport{}, ErrExport
	}
	entry := previous
	entry.OperationID, entry.IntentDigest = operationID, intent
	entry.Offer.Grant.State = "revoked"
	entry.Offer.Grant.Revision++
	entry.Offer.Grant.IssuedAt = now.UTC().Format(peerTimeFormat)
	if !closed("PeerLocalExport", entry) {
		return LocalExport{}, ErrExport
	}
	state.Connections[index].Exports = append(state.Connections[index].Exports, entry.Offer.Grant)
	state.Connections[index].LocalExports = append(state.Connections[index].LocalExports, entry)
	state.Revision++
	if err = e.store.Update(expected, state, now); err != nil {
		return LocalExport{}, err
	}
	return entry, nil
}

// Current is a local authorization check, not a Host acceptance or Run admission.
// A changed command/workspace/policy/adapter cannot reuse a reviewed grant.
func (e *Exporter) Current(membershipID, localAgentID string, now time.Time) (LocalExport, error) {
	state, err := e.store.Read()
	if err != nil {
		return LocalExport{}, err
	}
	_, connection, found := exportConnection(state, membershipID)
	if !found || connection.State != "active" || !after(connection.Receipt.Membership.ExpiresAt, now) {
		return LocalExport{}, ErrExport
	}
	grant, found := currentLocalGrant(connection, localAgentID)
	if !found || grant.State != "active" || !after(grant.ExpiresAt, now) ||
		grant.IssuedAt > now.Add(wire.ProofClockSkewSeconds*time.Second).UTC().Format(peerTimeFormat) {
		return LocalExport{}, ErrExport
	}
	source, err := e.resolve(localAgentID)
	if err != nil || source.AgentID != localAgentID || validExportSource(source) != nil {
		return LocalExport{}, ErrExport
	}
	digest, err := semanticDigest(source)
	if err != nil {
		return LocalExport{}, err
	}
	for _, entry := range connection.LocalExports {
		if entry.Offer.Grant.ExportID == grant.ExportID && entry.Offer.Grant.Revision == grant.Revision &&
			entry.ConfigurationDigest == digest && capabilitySubset(grant.Capabilities, source.Capabilities) {
			return entry, nil
		}
	}
	return LocalExport{}, ErrExport
}

func validExportSource(source ExportSource) error {
	cfg := source.Configuration
	if cfg.OwnerPrivateOutput || source.Capabilities.SupportsOwnerPrivateOutput || cfg.CentralApprovalRevision != 0 ||
		cfg.TrustedExecutionRevision != 0 || cfg.AuthorityNodeID != "" || !closed("PeerCapabilities", source.Capabilities) {
		return ErrExport
	}
	for _, label := range []string{cfg.Name, cfg.Role} {
		if label == "" || label != strings.TrimSpace(label) || len([]rune(label)) > 80 {
			return ErrExport
		}
		for _, char := range label {
			if char < 32 || char == 127 {
				return ErrExport
			}
		}
	}
	return nil
}
func localOperation(state State, operationID string) (LocalExport, bool) {
	for _, connection := range state.Connections {
		for _, entry := range connection.LocalExports {
			if entry.OperationID == operationID {
				return entry, true
			}
		}
	}
	return LocalExport{}, false
}
func exportConnection(state State, membershipID string) (int, LocalConnection, bool) {
	for i, connection := range state.Connections {
		if connection.Receipt.Membership.MembershipID == membershipID {
			return i, connection, true
		}
	}
	return 0, LocalConnection{}, false
}
func currentLocalGrant(connection LocalConnection, localAgentID string) (wire.AgentExportGrant, bool) {
	head := ""
	seen := map[string]bool{}
	var current wire.AgentExportGrant
	for _, grant := range connection.Exports {
		if grant.LocalAgentID != localAgentID {
			continue
		}
		if !seen[grant.ExportID] {
			head = grant.ExportID
			seen[grant.ExportID] = true
		}
		if grant.ExportID == head {
			current = grant
		}
	}
	return current, head != ""
}

func validateLocalExports(connection LocalConnection, operations map[string]bool) error {
	grants := map[string]wire.AgentExportGrant{}
	for _, grant := range connection.Exports {
		digest, err := semanticDigest(grant)
		if err != nil {
			return ErrStore
		}
		grants[digest] = grant
	}
	seen := map[string]bool{}
	for _, entry := range connection.LocalExports {
		digest, err := semanticDigest(entry.Offer.Grant)
		if err != nil || seen[digest] || operations[entry.OperationID] || !equalJSON(grants[digest], entry.Offer.Grant) {
			return ErrStore
		}
		seen[digest], operations[entry.OperationID] = true, true
	}
	return nil
}
