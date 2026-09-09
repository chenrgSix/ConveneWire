package connection

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/pairing"
	contracts "convenewire.dev/contracts/generated/go"
)

func TestCentralApprovalClientRejectsStaleMalformedOrRedirectedDecisions(t *testing.T) {
	for _, mode := range []string{"allow", "deny", "expired", "wrong_digest", "wrong_run", "redirect", "timeout", "stale_consent"} {
		t.Run(mode, func(t *testing.T) {
			var calls, redirected atomic.Int32
			other := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirected.Add(1) }))
			defer other.Close()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Header.Get("Authorization") != "Bearer fixture-credential" {
					t.Error("missing Device credential")
				}
				if mode == "redirect" {
					http.Redirect(w, r, other.URL, http.StatusTemporaryRedirect)
					return
				}
				body, _ := io.ReadAll(r.Body)
				var request contracts.RuntimeApprovalRequestedMessage
				if json.Unmarshal(body, &request) != nil {
					t.Error("malformed request")
					return
				}
				hash := sha256.Sum256([]byte(request.Payload.Details))
				decision := contracts.DecisionEnum("allow")
				if mode == "deny" || mode == "expired" {
					decision = contracts.DecisionEnum(mode)
				}
				if mode == "timeout" {
					decision = "pending"
				}
				payload := contracts.RuntimeApprovalDecisionPayload{RequestID: request.Payload.RequestID, RunID: request.Payload.RunID, Digest: hex.EncodeToString(hash[:]), Decision: decision}
				if mode == "wrong_digest" {
					payload.Digest = strings.Repeat("0", 64)
				}
				if mode == "wrong_run" {
					payload.RunID = "run_otherfixture01"
				}
				_ = json.NewEncoder(w).Encode(contracts.RuntimeApprovalDecisionMessage{ProtocolVersion: "1.0", MessageID: "msg_approvalfixture01",
					Type: contracts.RuntimeApprovalDecision, Timestamp: time.Now().UTC(), Payload: payload})
			}))
			defer server.Close()
			cfg := config.Config{ServerURL: server.URL, DeviceExecutionTrust: &config.DeviceExecutionTrust{
				Mode: "central-approval", Revision: 1, ServerURL: server.URL, DeviceID: "device_fixture01", OwnerMemberID: "member_fixture01"}}
			credential := pairing.Credential{ServerURL: server.URL, DeviceID: "device_fixture01", OwnerMemberID: "member_fixture01", Token: "fixture-credential"}
			input := contracts.RuntimeApprovalRequestedPayload{RequestID: "approval_transport01", RunID: "run_transport01", AgentID: "agent_transport01",
				Details: "Command: pwd", OperationKind: "command", Revision: 1, ExpiresAt: time.Now().Add(5 * time.Second).UTC()}
			if mode == "stale_consent" {
				input.Revision = 2
			}
			if mode == "timeout" {
				input.ExpiresAt = time.Now().Add(100 * time.Millisecond).UTC()
			}
			allowed, _ := AwaitCentralApproval(cfg, credential)(context.Background(), input)
			if allowed != (mode == "allow") {
				t.Fatal("unexpected authorization")
			}
			if redirected.Load() != 0 {
				t.Fatal("credential followed redirect")
			}
			if mode == "stale_consent" && calls.Load() != 0 {
				t.Fatal("stale consent reached network")
			}
		})
	}
}
