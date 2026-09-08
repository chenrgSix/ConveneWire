package connection

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	contracts "convenewire.dev/contracts/generated/go"
	execution "convenewire.dev/contracts/generated/go/execution"
	wire "convenewire.dev/contracts/generated/go/runtime"
)

func (c Client) handleWorkRequest(ctx context.Context, message contracts.WorkAuthorizationRequestedMessage,
	epoch int64, prepared PreparedRuns, publish func(context.Context, PreparedRuns) error,
	send func(context.Context, any) error) error {
	if c.HandleWorkAuthorization == nil || message.Payload.ConnectionEpoch != epoch ||
		message.Payload.WorkAuthorization.DeviceID != c.Credential.DeviceID {
		return errors.New("work authorization is outside this connection")
	}
	raw, err := json.Marshal(message.Payload.WorkAuthorization)
	if err != nil {
		return err
	}
	normalized, err := wire.ValidateAndNormalizeExecutionCommand("workAuthorization", raw)
	if err != nil {
		return err
	}
	var request execution.WorkAuthorization
	if json.Unmarshal(normalized, &request) != nil {
		return errors.New("invalid exact work authorization")
	}
	negotiated := false
	for _, offers := range prepared.WorkPolicyOffers {
		for _, offer := range offers {
			if offer.Spec.AgentID == request.Spec.AgentID && offer.Spec.PolicyID == request.Parent.PolicyID &&
				offer.Digest == request.Parent.PolicyDigest {
				negotiated = true
			}
		}
	}
	if !negotiated {
		return errors.New("work policy was not offered on this connection")
	}
	receipt, refreshed, err := c.HandleWorkAuthorization(ctx, request)
	if err != nil {
		return err
	}
	rawReceipt, err := json.Marshal(receipt)
	digest, digestErr := wire.ExecutionDigest(normalized)
	if err != nil || digestErr != nil || wire.ValidateExecutionCommand("workAuthorizationReceipt", rawReceipt) != nil ||
		receipt.RequestDigest != digest || receipt.DeviceID != c.Credential.DeviceID ||
		receipt.AuthorizationID != request.Parent.AuthorizationID {
		return errors.New("work authorization receipt identity changed")
	}
	if receipt.Status == "authorized" && (receipt.Grant == nil ||
		receipt.Grant.Grant.GrantID != request.Spec.GrantID || receipt.Grant.AgentID != request.Spec.AgentID ||
		receipt.Grant.PlanID != request.Spec.PlanID || receipt.Grant.NodeKey != request.Spec.NodeKey ||
		receipt.Grant.DeviceID != request.DeviceID || receipt.Grant.RevokedAt != nil) {
		return errors.New("work authorization returned another grant")
	}
	// Publish the current grant inventory before acknowledging success. A lost
	// response replays the same immutable issuance after reconnect/recovery.
	if err := publish(ctx, refreshed); err != nil {
		return err
	}
	result := contracts.WorkAuthorizationReceiptMessage{ProtocolVersion: "1.0", MessageID: newID("msg"),
		Timestamp: time.Now().UTC(), Type: contracts.WorkAuthorizationReceipt,
		Payload: contracts.WorkAuthorizationReceiptPayload{ConnectionEpoch: epoch}}
	if json.Unmarshal(rawReceipt, &result.Payload.WorkAuthorizationReceipt) != nil {
		return errors.New("invalid authorization receipt encoding")
	}
	return send(ctx, result)
}
