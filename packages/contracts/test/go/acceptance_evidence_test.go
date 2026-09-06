package contracts_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	work "convenewire.dev/contracts/generated/go/work"
)

func TestAcceptanceEvidencePreservesExactWireValues(t *testing.T) {
	source, err := os.ReadFile(filepath.Join(packageRoot(t), "fixtures", "cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var suite fixtureSuite
	if err := json.Unmarshal(source, &suite); err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, fixture := range suite.Cases {
		if !fixture.Valid || !strings.HasSuffix(fixture.SchemaID, "#/$defs/resultAcceptanceEvidence") {
			continue
		}
		count++
		t.Run(fixture.Name, func(t *testing.T) {
			var value work.ResultAcceptanceEvidence
			if err := json.Unmarshal(fixture.Instance, &value); err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(decodeJSON(t, fixture.Instance), decodeJSON(t, encoded)) {
				t.Fatal("typed round trip changed criterion, candidate, receipt or null identity")
			}
		})
	}
	if count != 2 {
		t.Fatalf("expected both acceptance evidence fixtures, got %d", count)
	}
}
