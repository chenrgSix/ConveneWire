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
