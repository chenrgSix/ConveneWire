package authority

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"time"

	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/pairing"
	"convenewire.dev/bridge/internal/privatefs"
	wire "convenewire.dev/contracts/generated/go/authority"
	executionwire "convenewire.dev/contracts/generated/go/runtime"
)

const ConfigurationFilename = "authority-connectors.json"

// Multi-Authority mode requires the Owner's existing stable local identity map.
// A missing or renamed identity is never provisioned as part of startup.
func ReadLocalIdentities(root string, agents []config.AgentConfig) (map[string]string, error) {
	raw, err := privatefs.ReadFile(filepath.Join(root, "agent-identities.json"), 1<<20)
	if err != nil {
		return nil, ErrPartition
	}
	raw, err = executionwire.CanonicalExecutionJSON(raw)
	if err != nil {
		return nil, ErrPartition
	}
	var ids map[string]string
	if json.Unmarshal(raw, &ids) != nil || ids == nil {
		return nil, ErrPartition
	}
	validID := regexp.MustCompile(`^agent_[A-Za-z0-9_-]{8,128}$`)
	for _, id := range ids {
		if !validID.MatchString(id) {
			return nil, ErrPartition
		}
	}
	seen := map[string]bool{}
	for _, agent := range agents {
		id := ids[agent.Name]
		if id == "" || seen[id] {
			return nil, ErrPartition
		}
		seen[id] = true
	}
	return ids, nil
}

var ErrPartition = errors.New("Authority partition is missing, ambiguous or bound to a different identity; restore the original owner data")

// Configuration is an explicit private owner file, never discovered in other profiles.
func ReadConfiguration(root string) (*wire.AuthorityConnectionsConfig, error) {
	path := filepath.Join(root, ConfigurationFilename)
	if _, err := os.Lstat(path); os.IsNotExist(err) {
		if _, err := os.Lstat(filepath.Join(root, "authorities")); !os.IsNotExist(err) {
			return nil, ErrPartition
		}
		return nil, nil
	}
	source, err := privatefs.ReadFile(path, 65536)
	if err != nil {
		return nil, err
	}
	source, err = executionwire.CanonicalExecutionJSON(source)
	if err != nil {
		return nil, ErrPartition
	}
	var result wire.AuthorityConnectionsConfig
	if wire.Decode("AuthorityConnectionsConfig", source, &result) != nil {
		return nil, ErrPartition
	}
	return &result, nil
}

type receipt struct {
	SchemaVersion   int               `json:"schemaVersion"`
	Binding         Binding           `json:"binding"`
	LocalIdentities map[string]string `json:"localIdentities,omitempty"`
}

func requireFresh(v Verified) error {
	if verify(v.payload, v.binding, v.payload.Nonce, time.Now()) != nil {
		return ErrIdentity
	}
	return nil
}

// AdoptPrimary writes only a receipt. Existing Inbox bytes, digests, sessions and
// consent files remain in place. The owning core must hold the root lease.
func AdoptPrimary(root string, v Verified, identities map[string]string) error {
	if requireFresh(v) != nil {
		return ErrIdentity
	}
	raw, err := privatefs.ReadFile(filepath.Join(root, "device-credential.json"), 1<<20)
	if err != nil {
		return ErrPartition
	}
	var saved pairing.Credential
	if json.Unmarshal(raw, &saved) != nil {
		return ErrPartition
	}
	cfg := v.binding.Pin
	actual, err := bindingForSavedCredential(saved, cfg)
	if err != nil || actual != v.binding {
		return ErrPartition
	}
	// Check the saved identity map, not just caller-provided aliases.
	raw, err = privatefs.ReadFile(filepath.Join(root, "agent-identities.json"), 1<<20)
	if err != nil {
		return ErrPartition
	}
	var savedIDs map[string]string
	canonical, err := executionwire.CanonicalExecutionJSON(raw)
	if err != nil || json.Unmarshal(canonical, &savedIDs) != nil || !reflect.DeepEqual(savedIDs, identities) {
		return ErrPartition
	}
	for _, id := range identities {
		if !regexp.MustCompile(`^agent_[A-Za-z0-9_-]{8,128}$`).MatchString(id) {
			return ErrPartition
		}
	}
	directory := filepath.Join(root, "authorities")
	expected := receipt{SchemaVersion: 1, Binding: v.binding, LocalIdentities: identities}
	if _, err := os.Lstat(directory); os.IsNotExist(err) {
		if err := privatefs.CreateDirectory(directory); err != nil {
			return err
		}
		return writeReceipt(filepath.Join(directory, "primary.json"), expected)
	}
	if privatefs.EnsureDirectory(directory) != nil {
		return ErrPartition
	}
	current, err := readReceipt(filepath.Join(directory, "primary.json"))
	if err != nil || current.Binding != expected.Binding || current.LocalIdentities == nil {
		return ErrPartition
	}
	for name, id := range current.LocalIdentities {
		if identities[name] != id {
			return ErrPartition
		}
	}
	return nil
}

func bindingForSavedCredential(saved pairing.Credential, pin wire.AuthorityPin) (Binding, error) {
	v, err := NewVerifier(config.Config{ServerURL: saved.ServerURL}, saved, pin)
	if err != nil {
		return Binding{}, err
	}
	return v.binding, nil
}

// OpenPartition starts fresh for an additional Authority. An existing directory
// without its exact receipt is never adopted. One connector per Authority in B.
func OpenPartition(root string, v Verified) (string, error) {
	if requireFresh(v) != nil {
		return "", ErrIdentity
	}
	base := filepath.Join(root, "authorities")
	primary, err := readReceipt(filepath.Join(base, "primary.json"))
	if err != nil || primary.Binding.Pin.AuthorityNodeID == v.NodeID() {
		return "", ErrPartition
	}
	directory := filepath.Join(base, v.NodeID())
	expected := receipt{SchemaVersion: 1, Binding: v.binding}
	if _, err := os.Lstat(directory); os.IsNotExist(err) {
		if err := privatefs.CreateDirectory(directory); err != nil {
			return "", err
		}
		if err := writeReceipt(filepath.Join(directory, "receipt.json"), expected); err != nil {
			return "", err
		}
	} else {
		if privatefs.EnsureDirectory(directory) != nil {
			return "", ErrPartition
		}
		current, err := readReceipt(filepath.Join(directory, "receipt.json"))
		if err != nil || !reflect.DeepEqual(current, expected) {
			return "", ErrPartition
		}
	}
	return directory, nil
}

func writeReceipt(path string, value receipt) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return privatefs.WriteFile(path, raw)
}
func readReceipt(path string) (receipt, error) {
	var r receipt
	raw, err := privatefs.ReadFile(path, 1<<20)
	if err != nil {
		return r, ErrPartition
	}
	raw, err = executionwire.CanonicalExecutionJSON(raw)
	if err != nil {
		return r, ErrPartition
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&r) != nil || r.SchemaVersion != 1 {
		return r, ErrPartition
	}
	return r, nil
}

// KnownPrimary checks the existing receipt before other connectors start while
// the primary Host is offline. It grants no execution; each connector still
// obtains fresh proof before connecting, recovery and Runtime start.
func (v *Verifier) KnownPrimary(root string, identities map[string]string) (bool, error) {
	base := filepath.Join(root, "authorities")
	if _, err := os.Lstat(base); os.IsNotExist(err) {
		return false, nil
	}
	if privatefs.EnsureDirectory(base) != nil {
		return false, ErrPartition
	}
	current, err := readReceipt(filepath.Join(base, "primary.json"))
	if err != nil || current.Binding != v.binding || current.LocalIdentities == nil {
		return false, ErrPartition
	}
	for name, id := range current.LocalIdentities {
		if identities[name] != id {
			return false, ErrPartition
		}
	}
	return true, nil
}

// BindProjections extends immutable projection-to-local-Agent claims. Removing
// a configured alias does not permit reassigning its historical identity later.
func BindProjections(partition string, v Verified, projections map[string]string) error {
	if requireFresh(v) != nil {
		return ErrIdentity
	}
	current, err := readReceipt(filepath.Join(partition, "receipt.json"))
	if err != nil || current.Binding != v.binding {
		return ErrPartition
	}
	directory := filepath.Join(partition, "projections")
	if privatefs.EnsureDirectory(directory) != nil {
		return ErrPartition
	}
	validID := regexp.MustCompile(`^agent_[A-Za-z0-9_-]{8,128}$`)
	for projection, local := range projections {
		if !validID.MatchString(projection) || !validID.MatchString(local) {
			return ErrPartition
		}
		path := filepath.Join(directory, projection+".json")
		expected, _ := json.Marshal(map[string]string{"projectionAgentId": projection, "localAgentId": local})
		if _, err := os.Lstat(path); os.IsNotExist(err) {
			if err := privatefs.WriteFile(path, expected); err != nil {
				return err
			}
			continue
		}
		actual, err := privatefs.ReadFile(path, 1024)
		if err != nil || !bytes.Equal(actual, expected) {
			return ErrPartition
		}
	}
	return nil
}

type Partition struct {
	DataDir string
	Binding Binding
}

// OwnedPartitions includes removed/offline connectors for local process fencing.
// A configured live Host is not needed to settle already-owned OS processes.
func OwnedPartitions(root string) ([]Partition, error) {
	base := filepath.Join(root, "authorities")
	primary, err := readReceipt(filepath.Join(base, "primary.json"))
	if err != nil {
		return nil, err
	}
	result := []Partition{{DataDir: root, Binding: primary.Binding}}
	entries, err := os.ReadDir(base)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if entry.Name() == "primary.json" {
			continue
		}
		if !entry.IsDir() || !regexp.MustCompile(`^node_[A-Za-z0-9_-]{8,128}$`).MatchString(entry.Name()) {
			return nil, ErrPartition
		}
		directory := filepath.Join(base, entry.Name())
		if privatefs.EnsureDirectory(directory) != nil {
			return nil, ErrPartition
		}
		r, err := readReceipt(filepath.Join(directory, "receipt.json"))
		if err != nil || r.Binding.Pin.AuthorityNodeID != entry.Name() {
			return nil, ErrPartition
		}
		result = append(result, Partition{DataDir: directory, Binding: r.Binding})
	}
	return result, nil
}
