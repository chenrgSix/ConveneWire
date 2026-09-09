package contracts_test

import (
	local "convenewire.dev/contracts/generated/go/localnode"
	"encoding/json"
	"os"
	"testing"
)

func TestLocalNodeSharedFixtures(t *testing.T) {
	data, err := os.ReadFile("../fixtures/local-node.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Kind  string          `json:"kind"`
		Valid bool            `json:"valid"`
		Value json.RawMessage `json:"value"`
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, item := range cases {
		var value any
		err := local.Decode(item.Kind, item.Value, &value)
		if (err == nil) != item.Valid {
			t.Fatalf("%s validity differs: %s", item.Kind, item.Value)
		}
	}
}
