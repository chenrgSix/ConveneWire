package contracts_test

import (
	peer "convenewire.dev/contracts/generated/go/peer"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestPeerStrictCanonicalJSON(t *testing.T) {
	data, err := os.ReadFile("../fixtures/peer-json.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Good []struct{ Input, Canonical string }
		Bad  []string
	}
	if err = json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, item := range fixtures.Good {
		got, err := peer.CanonicalJSON([]byte(item.Input))
		if err != nil || string(got) != item.Canonical {
			t.Fatalf("canonical %q: %s %v", item.Input, got, err)
		}
	}
	fixtures.Bad = append(fixtures.Bad, string([]byte{'"', 0xed, 0xa0, 0x80, '"'}), strings.Repeat("[", 65)+"0"+strings.Repeat("]", 65), `"`+strings.Repeat("x", peer.MaximumJSONBytes)+`"`)
	for _, input := range fixtures.Bad {
		if _, err := peer.CanonicalJSON([]byte(input)); err == nil {
			t.Fatalf("accepted invalid JSON %q", input[:min(len(input), 100)])
		}
	}
}
