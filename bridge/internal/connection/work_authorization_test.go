package connection

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/identity"
	"convenewire.dev/bridge/internal/pairing"
	contracts "convenewire.dev/contracts/generated/go"
	execution "convenewire.dev/contracts/generated/go/execution"
	wire "convenewire.dev/contracts/generated/go/runtime"
	"github.com/coder/websocket"
)

func workConnectionFixture(t *testing.T) (execution.WorkPolicyOffer, execution.WorkAuthorization) {
	t.Helper()
	raw, err := os.ReadFile("../../../packages/contracts/fixtures/work-policy-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var suite struct {
		Cases []struct {
			Kind     string
			Instance json.RawMessage
			Valid    bool
		}
	}
	if err := json.Unmarshal(raw, &suite); err != nil {
		t.Fatal(err)
	}
	var offer execution.WorkPolicyOffer
	var request execution.WorkAuthorization
	for _, fixture := range suite.Cases {
		if !fixture.Valid {
			continue
		}
		switch fixture.Kind {
		case "workPolicyOffer":
			_ = json.Unmarshal(fixture.Instance, &offer)
		case "workAuthorization":
			_ = json.Unmarshal(fixture.Instance, &request)
		}
	}
	return offer, request
}

func workRequestMessage(t *testing.T, request execution.WorkAuthorization, epoch int64) contracts.WorkAuthorizationRequestedMessage {
	t.Helper()
	message := contracts.WorkAuthorizationRequestedMessage{ProtocolVersion: "1.0", MessageID: "msg_work_connection01", Timestamp: time.Now().UTC(),
		Type: contracts.WorkAuthorizationRequested, Payload: contracts.WorkAuthorizationRequestedPayload{ConnectionEpoch: epoch}}
	raw, _ := json.Marshal(request)
	if err := json.Unmarshal(raw, &message.Payload.WorkAuthorization); err != nil {
		t.Fatal(err)
	}
	return message
}

func TestWorkAuthorizationUsesOneConnectionAndPublishesBeforeReceipt(t *testing.T) {
	offer, request := workConnectionFixture(t)
	dir := t.TempDir()
	agents := []config.AgentConfig{{Name: "Builder", Role: "Implementation", Adapter: "generic", Command: []string{"agent"}, Workspace: dir}}
	ids, err := identity.LoadOrCreate(dir, agents)
	if err != nil {
		t.Fatal(err)
	}
	offer.Spec.AgentID, request.Spec.AgentID = ids["Builder"], ids["Builder"]
	initial := PreparedRuns{WorkPolicyOffers: map[string][]execution.WorkPolicyOffer{"Builder": {offer}}}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	observed := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("authorization") != "Bearer device-secret" {
			http.Error(w, "unauthorized", 401)
			return
		}
		socket, err := websocket.Accept(w, r, nil)
		if err != nil {
			observed <- err
			return
		}
		defer socket.CloseNow()
		read := func() (map[string]any, error) {
			_, raw, err := socket.Read(ctx)
			if err != nil {
				return nil, err
			}
			var v map[string]any
			err = json.Unmarshal(raw, &v)
			return v, err
		}
		hello, err := read()
		if err != nil {
			observed <- err
			return
		}
		payload := hello["payload"].(map[string]any)
		if payload["governedExecution"] == nil {
			observed <- fmt.Errorf("offers omitted device capability")
			return
		}
		epoch := int64(payload["connectionEpoch"].(float64))
		publication, err := read()
		if err != nil {
			observed <- err
			return
		}
		caps := publication["payload"].(map[string]any)["capabilities"].(map[string]any)
		if caps["workPolicyOffers"] == nil || caps["governedExecution"] != nil {
			observed <- fmt.Errorf("policy advertisement already claimed a grant")
			return
		}
		for i := 0; i < 2; i++ {
			value := request
			if i == 1 {
				value.Parent.AuthorizationID = "op_work_connection02"
				value.Spec.TaskID = "task_work_connection02"
				value.Spec.PlanID = "plan_work_connection02"
			}
			parent, _ := json.Marshal(value.Parent)
			value.Spec.GrantID, _ = wire.WorkTaskGrantID(parent)
			message := workRequestMessage(t, value, epoch)
			raw, _ := json.Marshal(message)
			if err := socket.Write(ctx, websocket.MessageText, raw); err != nil {
				observed <- err
				return
			}
			publication, err = read()
			if err != nil {
				observed <- err
				return
			}
			if publication["type"] != "agent.publish" {
				observed <- fmt.Errorf("grant was not published first")
				return
			}
			caps = publication["payload"].(map[string]any)["capabilities"].(map[string]any)
			grants := caps["governedExecution"].(map[string]any)["readyGrants"].([]any)
			if len(grants) != i+1 {
				observed <- fmt.Errorf("earlier grant lost during publication")
				return
			}
			reply, err := read()
			if err != nil {
				observed <- err
				return
			}
			if reply["type"] != "work.authorization.receipt" {
				observed <- fmt.Errorf("missing negotiated receipt")
				return
			}
		}
		observed <- nil
		<-ctx.Done()
	}))
	defer server.Close()
	retained := []execution.ExecutionGrantSummary{}
	client := Client{Config: config.Config{ServerURL: server.URL, DataDir: dir, Agents: agents}, Credential: pairing.Credential{
		ServerURL: server.URL, DeviceID: request.DeviceID, TeamID: "team_work_connection01", OwnerMemberID: "member_work_connection01", Token: "device-secret"},
		BridgeVersion: "0.4.0", HeartbeatInterval: time.Hour, PrepareRuns: func(context.Context) (PreparedRuns, error) { return initial, nil },
		HandleWorkAuthorization: func(_ context.Context, v execution.WorkAuthorization) (execution.WorkAuthorizationReceipt, PreparedRuns, error) {
			grant := preparedGovernedGrant(v.Spec.AgentID, v.DeviceID)
			grant.Grant.GrantID = v.Spec.GrantID
			grant.PlanID = v.Spec.PlanID
			grant.NodeKey = v.Spec.NodeKey
			retained = append(retained, grant)
			raw, _ := json.Marshal(v)
			digest, _ := wire.ExecutionDigest(raw)
			receipt := execution.WorkAuthorizationReceipt{Version: 1, DeviceID: v.DeviceID, AuthorizationID: v.Parent.AuthorizationID,
				RequestDigest: digest, Status: "authorized", Reason: "authorized", ObservedAt: time.Now().UTC().Format(time.RFC3339Nano)}
			raw, _ = json.Marshal(grant)
			_ = json.Unmarshal(raw, &receipt.Grant)
			return receipt, PreparedRuns{WorkPolicyOffers: initial.WorkPolicyOffers, GovernedExecutionGrants: map[string][]execution.ExecutionGrantSummary{"Builder": retained}}, nil
		}}
	done := make(chan error, 1)
	go func() { _, err := client.connectOnce(ctx); done <- err }()
	select {
	case err := <-observed:
		if err != nil {
			t.Error(err)
		}
	case <-ctx.Done():
		t.Error("negotiation timed out")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("negotiation worker did not drain")
	}
}

func TestWorkAuthorizationRejectsEpochDeviceAndUnofferedPolicyBeforeCallback(t *testing.T) {
	offer, request := workConnectionFixture(t)
	called := false
	c := Client{Credential: pairing.Credential{DeviceID: request.DeviceID}, HandleWorkAuthorization: func(context.Context, execution.WorkAuthorization) (execution.WorkAuthorizationReceipt, PreparedRuns, error) {
		called = true
		return execution.WorkAuthorizationReceipt{}, PreparedRuns{}, nil
	}}
	for _, kind := range []string{"epoch", "device", "policy"} {
		t.Run(kind, func(t *testing.T) {
			message := workRequestMessage(t, request, 1)
			prepared := PreparedRuns{WorkPolicyOffers: map[string][]execution.WorkPolicyOffer{"Builder": {offer}}}
			switch kind {
			case "epoch":
				message.Payload.ConnectionEpoch = 2
			case "device":
				message.Payload.WorkAuthorization.DeviceID = "device_other0001"
			case "policy":
				prepared.WorkPolicyOffers = nil
			}
			err := c.handleWorkRequest(context.Background(), message, 1, prepared, func(context.Context, PreparedRuns) error { t.Fatal("published rejected request"); return nil }, func(context.Context, any) error { t.Fatal("sent rejected request"); return nil })
			if err == nil || called {
				t.Fatal("unnegotiated request reached authority")
			}
		})
	}
}
