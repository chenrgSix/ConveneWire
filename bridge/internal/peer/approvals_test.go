package peer

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	bridgeruntime "convenewire.dev/bridge/internal/runtime"
	contracts "convenewire.dev/contracts/generated/go"
	wire "convenewire.dev/contracts/generated/go/peer"
)

func approvalBinding() wire.PeerExecutionBinding {
	return wire.PeerExecutionBinding{SchemaVersion: 1, AuthorityNodeID: "node_approvalhost001", ParticipantNodeID: "node_approvallocal001",
		PeerID: "peer_approvalpeer001", TeamID: "team_approvalteam001", RoomID: "room_approvalroom001", RunID: "run_approvalrun001",
		ProjectionAgentID: "agent_projection001", LocalAgentID: "agent_localagent001", ExportID: "export_approval001", GrantRevision: 3,
		GrantDigest: strings.Repeat("a", 64), AcceptanceID: "acceptance_approval001", AcceptanceRevision: 2,
		AcceptanceDigest: strings.Repeat("b", 64), RequestDigest: strings.Repeat("c", 64)}
}

func approvalInput(binding wire.PeerExecutionBinding, id string) contracts.RuntimeApprovalRequestedPayload {
	return contracts.RuntimeApprovalRequestedPayload{RequestID: id, RunID: binding.RunID, AgentID: binding.ProjectionAgentID,
		Revision: binding.GrantRevision, OperationKind: "command", Details: "Command: pwd", ExpiresAt: time.Now().Add(time.Minute)}
}

func waitApproval(t *testing.T, approvals *Approvals, id string) ApprovalView {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		for _, view := range approvals.Pending() {
			if view.RequestID == id {
				return view
			}
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("local approval did not become reviewable")
	return ApprovalView{}
}

func approvalDecision(view ApprovalView) ApprovalDecision {
	return ApprovalDecision{RequestID: view.RequestID, ProcessID: view.ProcessID, BindingDigest: view.BindingDigest, ConsentRevision: view.ConsentRevision, Allow: true}
}

type approvalResult struct {
	allow bool
	err   error
}

func askApproval(ctx context.Context, session bridgeruntime.LocalApprovalSession, input contracts.RuntimeApprovalRequestedPayload) <-chan approvalResult {
	done := make(chan approvalResult, 1)
	go func() {
		allow, err := session.Approve(ctx, input)
		done <- approvalResult{allow, err}
	}()
	return done
}

func TestPeerApprovalRequiresExactLocalDecisionAndFreshAuthorityAfterWaiting(t *testing.T) {
	for _, mode := range []string{"allow", "deny", "changed authority", "changed during freshness"} {
		t.Run(mode, func(t *testing.T) {
			var checks atomic.Int32
			var valid atomic.Bool
			valid.Store(true)
			live, cancel := context.WithCancel(context.Background())
			defer cancel()
			approvals := &Approvals{}
			defer approvals.Close()
			binding := approvalBinding()
			session, err := approvals.Open(live, binding, func(ctx context.Context) error {
				if checks.Add(1) == 3 && mode == "changed during freshness" {
					cancel()
				}
				if !valid.Load() {
					return ErrExport
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			defer session.Close()
			input := approvalInput(binding, "approval_request001")
			done := askApproval(live, session, input)
			view := waitApproval(t, approvals, input.RequestID)
			if !equalJSON(view.Binding, binding) || view.ConsentRevision != binding.GrantRevision {
				t.Fatal("review omitted the exact Peer or local Export")
			}
			for _, change := range []string{"process", "digest", "revision", "request"} {
				decision := approvalDecision(view)
				switch change {
				case "process":
					decision.ProcessID += "changed"
				case "digest":
					decision.BindingDigest = strings.Repeat("d", 64)
				case "revision":
					decision.ConsentRevision++
				case "request":
					decision.RequestID += "changed"
				}
				if err := approvals.Decide(decision); !errors.Is(err, ErrApproval) {
					t.Fatal("substituted approval accepted", change, err)
				}
			}
			decision := approvalDecision(view)
			decision.Allow = mode != "deny"
			if mode == "changed authority" {
				valid.Store(false)
			}
			if err := approvals.Decide(decision); err != nil {
				t.Fatal(err)
			}
			result := <-done
			if mode == "allow" || mode == "deny" {
				if result.err != nil || result.allow != decision.Allow || checks.Load() != 3 {
					t.Fatal("decision bypassed fresh post-wait authority", result, checks.Load())
				}
			} else if result.allow || result.err == nil {
				t.Fatal("stale authority resumed the process", result)
			}
			if err := approvals.Decide(decision); !errors.Is(err, ErrApproval) {
				t.Fatal("decision replay accepted", err)
			}
			if allowed, err := session.Approve(live, input); allowed || err == nil {
				t.Fatal("callback ID reused after settlement")
			}
		})
	}
}

func TestPeerApprovalDiesWithProcessConnectorRunExpiryOrRevocation(t *testing.T) {
	for _, mode := range []string{"process", "connector", "run", "expiry", "peer revoke", "core close"} {
		t.Run(mode, func(t *testing.T) {
			live, disconnect := context.WithCancel(context.Background())
			defer disconnect()
			approvals := &Approvals{}
			defer approvals.Close()
			binding := approvalBinding()
			session, err := approvals.Open(live, binding, func(context.Context) error { return nil })
			if err != nil {
				t.Fatal(err)
			}
			defer session.Close()
			requestContext, stop := context.WithCancel(live)
			defer stop()
			input := approvalInput(binding, "approval_invalidation001")
			if mode == "expiry" {
				input.ExpiresAt = time.Now().Add(80 * time.Millisecond)
			}
			done := askApproval(requestContext, session, input)
			view := waitApproval(t, approvals, input.RequestID)
			switch mode {
			case "process":
				session.Close()
			case "connector":
				disconnect()
			case "run":
				stop()
			case "peer revoke":
				approvals.RevokePeer(binding.PeerID)
			case "core close":
				approvals.Close()
			}
			select {
			case result := <-done:
				if result.allow || result.err == nil {
					t.Fatal("invalidated process retained authority")
				}
			case <-time.After(time.Second):
				t.Fatal("invalidation left an approval waiting")
			}
			if len(approvals.Pending()) != 0 || !errors.Is(approvals.Decide(approvalDecision(view)), ErrApproval) {
				t.Fatal("late decision survived invalidation")
			}
		})
	}
}

func TestPeerApprovalRevocationIsIsolatedAndRestartCannotReuseDecisions(t *testing.T) {
	approvals := &Approvals{}
	defer approvals.Close()
	first := approvalBinding()
	second := first
	second.PeerID, second.AuthorityNodeID = "peer_otherpeer001", "node_otherhost001"
	views := []ApprovalView{}
	done := []<-chan approvalResult{}
	for index, binding := range []wire.PeerExecutionBinding{first, second} {
		session, err := approvals.Open(context.Background(), binding, func(context.Context) error { return nil })
		if err != nil {
			t.Fatal(err)
		}
		defer session.Close()
		input := approvalInput(binding, []string{"approval_firstrequest001", "approval_secondrequest001"}[index])
		done = append(done, askApproval(context.Background(), session, input))
		views = append(views, waitApproval(t, approvals, input.RequestID))
	}
	approvals.RevokePeer(first.PeerID)
	if result := <-done[0]; result.allow || result.err == nil {
		t.Fatal("revoked Peer resumed")
	}
	if err := approvals.Decide(approvalDecision(views[1])); err != nil {
		t.Fatal("unrelated Peer approval canceled", err)
	}
	if result := <-done[1]; !result.allow || result.err != nil {
		t.Fatal(result)
	}
	restarted := &Approvals{}
	defer restarted.Close()
	replacement, err := restarted.Open(context.Background(), second, func(context.Context) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	defer replacement.Close()
	input := approvalInput(second, views[1].RequestID)
	newResult := askApproval(context.Background(), replacement, input)
	newView := waitApproval(t, restarted, input.RequestID)
	if newView.ProcessID == views[1].ProcessID || newView.BindingDigest != views[1].BindingDigest {
		t.Fatal("replacement did not allocate an independent live process owner")
	}
	if err := restarted.Decide(approvalDecision(views[1])); !errors.Is(err, ErrApproval) {
		t.Fatal("new core accepted previous process decision")
	}
	if err := restarted.Decide(approvalDecision(newView)); err != nil {
		t.Fatal(err)
	}
	if result := <-newResult; !result.allow || result.err != nil {
		t.Fatal(result)
	}
}

func TestPeerRevocationCancelsPostDecisionFreshnessRequest(t *testing.T) {
	approvals := &Approvals{}
	defer approvals.Close()
	var checks atomic.Int32
	checking := make(chan struct{})
	binding := approvalBinding()
	session, err := approvals.Open(context.Background(), binding, func(ctx context.Context) error {
		if checks.Add(1) == 3 {
			close(checking)
			<-ctx.Done()
			return ctx.Err()
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	input := approvalInput(binding, "approval_postdecision001")
	done := askApproval(context.Background(), session, input)
	view := waitApproval(t, approvals, input.RequestID)
	if err := approvals.Decide(approvalDecision(view)); err != nil {
		t.Fatal(err)
	}
	<-checking
	approvals.RevokePeer(binding.PeerID)
	select {
	case result := <-done:
		if result.allow || result.err == nil {
			t.Fatal("revocation allowed the pending Host freshness request")
		}
	case <-time.After(time.Second):
		t.Fatal("revoked process retained an in-flight approval check")
	}
}

func TestPeerApprovalRejectsChangedRequestScopeAndSensitiveDetails(t *testing.T) {
	approvals := &Approvals{}
	defer approvals.Close()
	binding := approvalBinding()
	session, err := approvals.Open(context.Background(), binding, func(context.Context) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	for _, mutation := range []string{"run", "agent", "revision", "expired", "extended", "kind", "secret", "oversized"} {
		input := approvalInput(binding, "approval_scope001")
		switch mutation {
		case "run":
			input.RunID += "changed"
		case "agent":
			input.AgentID = binding.LocalAgentID
		case "revision":
			input.Revision++
		case "expired":
			input.ExpiresAt = time.Now().Add(-time.Second)
		case "extended":
			input.ExpiresAt = time.Now().Add(time.Hour)
		case "kind":
			input.OperationKind = "unsupported"
		case "secret":
			input.Details = "token=secretvalue12345"
		case "oversized":
			input.Details = strings.Repeat("x", 12001)
		}
		if allow, err := session.Approve(context.Background(), input); allow || !errors.Is(err, ErrApproval) || len(approvals.Pending()) != 0 {
			t.Fatal("unsafe local request became reviewable", mutation, err)
		}
	}
}
