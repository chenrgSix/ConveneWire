package runtime

import (
	"context"
	"encoding/json"

	peerwire "convenewire.dev/contracts/generated/go/peer"
)

// PeerProcessAdapter adds Node-owned process evidence after Peer admission.
// It grants no execution or settlement permission and receives no Device owner.
type PeerProcessAdapter struct {
	Adapter Adapter
	Tracker GovernedProcessTracker
	Binding peerwire.PeerExecutionBinding
}

func (a PeerProcessAdapter) Name() string               { return a.Adapter.Name() }
func (a PeerProcessAdapter) Capabilities() Capabilities { return a.Adapter.Capabilities() }
func (a PeerProcessAdapter) Execute(ctx context.Context, request Request, emit EmitFunc) error {
	if a.Adapter == nil || a.Tracker == nil || request.Run.RunID != a.Binding.RunID ||
		request.Run.RoomID != a.Binding.RoomID || request.Run.TargetAgentID != a.Binding.ProjectionAgentID {
		return ErrGovernedProcessInvalid
	}
	raw, err := json.Marshal(a.Binding)
	var binding peerwire.PeerExecutionBinding
	if err != nil || peerwire.Decode("PeerExecutionBinding", raw, &binding) != nil {
		return ErrGovernedProcessInvalid
	}
	// Keep this identity stable when a retry changes authorization pins. Changed
	// pins must conflict with the old evidence instead of allocating a new Run.
	namespace := binding.AuthorityNodeID + "\x00" + binding.ParticipantNodeID + "\x00" + binding.PeerID + "\x00" + binding.RunID
	raw, err = json.Marshal(request.Run)
	if err != nil {
		return err
	}
	var frozen Request
	if err := json.Unmarshal(raw, &frozen.Run); err != nil {
		return err
	}
	request.Run = frozen.Run
	raw, err = json.Marshal(map[string]any{"binding": binding, "run": request.Run})
	if err != nil {
		return err
	}
	digest, err := peerwire.Digest(raw)
	if err != nil {
		return err
	}
	p := &authorityProcessContext{tracker: a.Tracker, domain: "convenewire.peer.process.v1", namespace: namespace, payloadDigest: digest}
	return a.Adapter.Execute(context.WithValue(ctx, authorityProcessContextKey{}, p), request, emit)
}
