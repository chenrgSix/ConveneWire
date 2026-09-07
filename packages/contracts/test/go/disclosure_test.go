package contracts_test

import (
	runtimecontracts "convenewire.dev/contracts/generated/go/runtime"
	"encoding/json"
	"os"
	"testing"
)

func TestSharedDisclosureContracts(t *testing.T) {
	source, err := os.ReadFile("../../fixtures/disclosure-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var suite struct {
		Cases []struct {
			Name  string
			Kind  string
			Value json.RawMessage
			Valid bool
		}
	}
	if err := json.Unmarshal(source, &suite); err != nil {
		t.Fatal(err)
	}
	for _, entry := range suite.Cases {
		t.Run(entry.Name, func(t *testing.T) {
			_, err := runtimecontracts.NormalizeDisclosureCommand(entry.Kind, entry.Value)
			if (err == nil) != entry.Valid {
				t.Fatalf("valid=%t error=%v", entry.Valid, err)
			}
		})
	}
}
func TestDisclosureDuplicateKeysRejected(t *testing.T) {
	if _, err := runtimecontracts.NormalizeDisclosureCommand("disclosureRevokeCommand", []byte(`{"expectedRevision":1,"expectedRevision":2}`)); err == nil {
		t.Fatal("duplicate accepted")
	}
}
