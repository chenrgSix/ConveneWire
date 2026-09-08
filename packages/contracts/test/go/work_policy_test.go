package contracts_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	execution "convenewire.dev/contracts/generated/go/execution"
	wire "convenewire.dev/contracts/generated/go/runtime"
)

func TestWorkPolicySharedWireFixtures(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(packageRoot(t), "fixtures", "work-policy-cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var suite struct {
		GrantID string `json:"grantId"`
		Cases   []struct {
			Name, Kind string
			Instance   json.RawMessage
			Valid      bool
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &suite); err != nil {
		t.Fatal(err)
	}
	constructors := map[string]func() any{
		"workPolicySpec":           func() any { return &execution.WorkPolicySpec{} },
		"workPolicyOffer":          func() any { return &execution.WorkPolicyOffer{} },
		"workGrantParent":          func() any { return &execution.WorkGrantParent{} },
		"workAuthorization":        func() any { return &execution.WorkAuthorization{} },
		"workAuthorizationReceipt": func() any { return &execution.WorkAuthorizationReceipt{} },
	}
	for _, fixture := range suite.Cases {
		t.Run(fixture.Name, func(t *testing.T) {
			normalized, err := wire.ValidateAndNormalizeExecutionCommand(fixture.Kind, fixture.Instance)
			if (err == nil) != fixture.Valid {
				t.Fatalf("valid=%t err=%v", fixture.Valid, err)
			}
			if !fixture.Valid {
				return
			}
			value := constructors[fixture.Kind]()
			if err := json.Unmarshal(normalized, value); err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(decodeJSON(t, normalized), decodeJSON(t, encoded)) {
				t.Fatal("typed roundtrip changed the exact authority")
			}
			if fixture.Kind == "workGrantParent" {
				id, err := wire.WorkTaskGrantID(normalized)
				if err != nil || id != suite.GrantID {
					t.Fatalf("identity mismatch %s %v", id, err)
				}
			}
			for _, source := range []string{
				strings.Replace(string(encoded), "{", `{"command":"arbitrary",`, 1),
				strings.Replace(string(encoded), "{", `{"revision":1,"revision":2,`, 1),
				string(encoded) + " {}",
			} {
				if err := wire.ValidateExecutionCommand(fixture.Kind, []byte(source)); err == nil {
					t.Fatal("accepted noncanonical or unbounded input")
				}
			}
			key := "policyId"
			if fixture.Kind == "workAuthorizationReceipt" {
				key = "requestDigest"
			}
			changed := strings.Replace(string(encoded), `"`+key+`":`, `"`+strings.ToUpper(key[:1])+key[1:]+`":`, 1)
			if changed == string(encoded) || wire.ValidateExecutionCommand(fixture.Kind, []byte(changed)) == nil {
				t.Fatal("accepted case-folded authority")
			}
		})
	}
}
