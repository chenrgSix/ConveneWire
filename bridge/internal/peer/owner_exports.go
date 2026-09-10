package peer

import (
	"sort"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

type SourceReview struct {
	LocalAgentID        string                `json:"localAgentId"`
	Name                string                `json:"name"`
	Role                string                `json:"role"`
	Workspace           string                `json:"workspace"`
	Sandbox             string                `json:"sandbox,omitempty"`
	Capabilities        wire.PeerCapabilities `json:"capabilities"`
	ConfigurationDigest string                `json:"configurationDigest,omitempty"`
	Available           bool                  `json:"available"`
}

func (s *Sources) Reviews() []SourceReview {
	views := []SourceReview{}
	for id, agent := range s.agents {
		view := SourceReview{LocalAgentID: id, Name: agent.Name, Role: agent.Role, Workspace: agent.Workspace}
		if source, err := s.Resolve(id); err == nil {
			view.Sandbox, view.Capabilities = source.Configuration.Sandbox, source.Capabilities
			view.ConfigurationDigest, _ = semanticDigest(source)
			view.Available = true
		}
		views = append(views, view)
	}
	sort.Slice(views, func(i, j int) bool { return views[i].LocalAgentID < views[j].LocalAgentID })
	return views
}

type OwnerExportView struct {
	Offer      AgentOffer        `json:"offer"`
	Current    bool              `json:"current"`
	Acceptance *AcceptanceRecord `json:"acceptance,omitempty"`
}

type OwnerConnectionView struct {
	Invitation wire.PeerInvitation `json:"invitation"`
	Membership wire.PeerMembership `json:"membership"`
	State      string              `json:"state"`
	Exports    []OwnerExportView   `json:"exports"`
}

// OwnerState omits machine/human credentials and proof journals. Its locally
// reviewed configuration data must never be reused as a Host-facing payload.
type OwnerState struct {
	Participant wire.PeerNodeIdentity `json:"participant"`
	LocalUserID string                `json:"localUserId"`
	Revision    int64                 `json:"revision"`
	Connections []OwnerConnectionView `json:"connections"`
}

func (e *Exporter) OwnerState(now time.Time) (OwnerState, error) {
	state, err := e.store.Read()
	if err != nil {
		return OwnerState{}, err
	}
	view := OwnerState{Participant: state.Participant, LocalUserID: state.LocalUserID, Revision: state.Revision, Connections: []OwnerConnectionView{}}
	for _, local := range state.Connections {
		connection := OwnerConnectionView{Invitation: local.Receipt.Invitation, Membership: local.Receipt.Membership, State: local.State, Exports: []OwnerExportView{}}
		latest := map[string]LocalExport{}
		for _, entry := range local.LocalExports {
			grant := entry.Offer.Grant
			head, found := currentLocalGrant(local, grant.LocalAgentID)
			if found && equalJSON(head, grant) {
				latest[grant.LocalAgentID] = entry
			}
		}
		for id, entry := range latest {
			v := OwnerExportView{Offer: entry.Offer}
			current, err := e.current(local, id, now)
			v.Current = err == nil && equalJSON(current, entry)
			if _, snapshot, found := acceptanceSnapshot(local, id); found && len(snapshot.AcceptanceHistory) > 0 {
				record := snapshot.AcceptanceHistory[len(snapshot.AcceptanceHistory)-1]
				v.Acceptance = &record
			}
			connection.Exports = append(connection.Exports, v)
		}
		sort.Slice(connection.Exports, func(i, j int) bool {
			return connection.Exports[i].Offer.Grant.LocalAgentID < connection.Exports[j].Offer.Grant.LocalAgentID
		})
		view.Connections = append(view.Connections, connection)
	}
	return view, nil
}

func (e *Exporter) PrepareReviewed(expected int64, configurationDigest string, request ExportRequest, now time.Time) (LocalExport, error) {
	source, err := e.resolve(request.LocalAgentID)
	if err != nil {
		return LocalExport{}, err
	}
	digest, err := semanticDigest(source)
	if err != nil || digest != configurationDigest {
		return LocalExport{}, ErrExport
	}
	source.Configuration = cloneSourceConfig(source.Configuration)
	reviewed := &Exporter{store: e.store, resolve: func(id string) (ExportSource, error) {
		if id != source.AgentID {
			return ExportSource{}, ErrExport
		}
		return source, nil
	}}
	return reviewed.Prepare(expected, request, now)
}
