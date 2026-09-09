package connection

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/pairing"
	contracts "convenewire.dev/contracts/generated/go"
	validation "convenewire.dev/contracts/generated/go/runtime"
)

// AwaitCentralApproval uses the already-paired outbound transport. Redirects
// cannot move the Device credential or the request to a different authority.
func AwaitCentralApproval(cfg config.Config, credential pairing.Credential) func(context.Context, contracts.RuntimeApprovalRequestedPayload) (bool, error) {
	return func(parent context.Context, payload contracts.RuntimeApprovalRequestedPayload) (bool, error) {
		if cfg.CentralApprovalRevision(credential.ServerURL, credential.DeviceID, credential.OwnerMemberID) != payload.Revision || payload.Revision < 1 {
			return false, errors.New("Central approval consent changed")
		}
		ctx, cancel := context.WithDeadline(parent, payload.ExpiresAt)
		defer cancel()
		client := pairing.HTTPClientForCredential(cfg, credential)
		client.Timeout = 10 * time.Second
		client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		defer client.CloseIdleConnections()
		envelope := contracts.RuntimeApprovalRequestedMessage{ProtocolVersion: "1.0", Type: contracts.RuntimeApprovalRequested,
			MessageID: "msg_" + strings.TrimPrefix(payload.RequestID, "approval_"), Timestamp: time.Now().UTC(), Payload: payload}
		body, err := json.Marshal(envelope)
		if err != nil || validation.ValidateBridgeMessage(body) != nil {
			return false, errors.New("Invalid approval request")
		}
		hash := sha256.Sum256([]byte(payload.Details))
		digest := hex.EncodeToString(hash[:])
		endpoint := strings.TrimRight(credential.ServerURL, "/") + "/api/bridge/runtime-approvals"
		// Re-submit the identical request after response loss; Central owns replay.
		for ctx.Err() == nil {
			request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
			if err != nil {
				return false, errors.New("Invalid approval endpoint")
			}
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Authorization", "Bearer "+credential.Token)
			response, err := client.Do(request)
			if err == nil {
				raw, readErr := io.ReadAll(io.LimitReader(response.Body, 65537))
				response.Body.Close()
				if response.StatusCode == http.StatusOK {
					var result contracts.RuntimeApprovalDecisionMessage
					if readErr != nil || len(raw) > 65536 || validation.ValidateBridgeMessage(raw) != nil || json.Unmarshal(raw, &result) != nil ||
						result.Type != contracts.RuntimeApprovalDecision || result.Payload.RequestID != payload.RequestID || result.Payload.RunID != payload.RunID || result.Payload.Digest != digest {
						return false, errors.New("Invalid approval decision")
					}
					switch result.Payload.Decision {
					case "allow":
						return ctx.Err() == nil, nil
					case "deny", "expired":
						return false, nil
					case "pending":
					default:
						return false, errors.New("Invalid approval decision")
					}
				} else if response.StatusCode < 500 && response.StatusCode != http.StatusTooManyRequests {
					return false, errors.New("Central rejected approval request")
				}
			}
			timer := time.NewTimer(time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
				return false, nil
			case <-timer.C:
			}
		}
		return false, nil
	}
}
