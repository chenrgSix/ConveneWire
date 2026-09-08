package contracts_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	contracts "convenewire.dev/contracts/generated/go"
	runtimecontracts "convenewire.dev/contracts/generated/go/runtime"
)

func TestConversationWireInterop(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(packageRoot(t), "fixtures", "conversation-work-cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var suite struct {
		Cases []struct {
			Name     string
			Valid    bool
			Instance json.RawMessage
		}
	}
	if json.Unmarshal(raw, &suite) != nil {
		t.Fatal("invalid fixture")
	}
	for _, item := range suite.Cases {
		t.Run(item.Name, func(t *testing.T) {
			err := runtimecontracts.ValidateBridgeMessage(item.Instance)
			if (err == nil) != item.Valid {
				t.Fatalf("valid=%t error=%v", item.Valid, err)
			}
			if !item.Valid {
				return
			}
			var envelope struct {
				Type string `json:"type"`
			}
			_ = json.Unmarshal(item.Instance, &envelope)
			var value any = &contracts.RunRequestedMessage{}
			if envelope.Type == "run.reply" {
				value = &contracts.RunReplyMessage{}
			}
			if err := json.Unmarshal(item.Instance, value); err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(value)
			if err != nil || !reflect.DeepEqual(decodeJSON(t, item.Instance), decodeJSON(t, encoded)) {
				t.Fatalf("wire round trip changed the proposal: %s %v", encoded, err)
			}
		})
	}
}
