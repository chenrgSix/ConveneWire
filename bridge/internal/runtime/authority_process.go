package runtime

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync/atomic"
)

type authorityProcessContextKey struct{}
type authorityProcessContext struct {
	tracker       GovernedProcessTracker
	namespace     string
	payloadDigest string
	attempt       atomic.Uint64
}

// AuthorityProcessAdapter adds durable process ownership to ordinary Runs. The
// process tracker is lifecycle evidence only, and grants no governed permission.
type AuthorityProcessAdapter struct {
	Adapter         Adapter
	Tracker         GovernedProcessTracker
	AuthorityNodeID string
}

func (a AuthorityProcessAdapter) Name() string               { return a.Adapter.Name() }
func (a AuthorityProcessAdapter) Capabilities() Capabilities { return a.Adapter.Capabilities() }
func (a AuthorityProcessAdapter) Execute(ctx context.Context, request Request, emit EmitFunc) error {
	if a.Tracker == nil || a.AuthorityNodeID == "" {
		return ErrGovernedProcessInvalid
	}
	raw, err := json.Marshal(request.Run)
	if err != nil {
		return err
	}
	p := &authorityProcessContext{tracker: a.Tracker, namespace: a.AuthorityNodeID + "\x00" + request.Run.RunID, payloadDigest: processDigest(raw)}
	return a.Adapter.Execute(context.WithValue(ctx, authorityProcessContextKey{}, p), request, emit)
}
func processDigest(raw []byte) string { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }
func (p *authorityProcessContext) identity() GovernedProcessIdentity {
	scope := fmt.Sprintf("convenewire.authority.process.v1\x00%s\x00%d", p.namespace, p.attempt.Add(1))
	digest := processDigest([]byte(scope))
	return GovernedProcessIdentity{RunID: "run_" + digest, AdmissionDigest: p.payloadDigest, StartDigest: digest}
}
