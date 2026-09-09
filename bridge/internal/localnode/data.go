package localnode

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"

	"convenewire.dev/bridge/internal/ownership"
	"convenewire.dev/bridge/internal/privatefs"
	contracts "convenewire.dev/contracts/generated/go/localnode"
)

const identityFile = "identity.json"

// Data holds the installation lease. Keep it until both Hub and Runtime stop.
type Data struct {
	Root     string
	Identity contracts.LocalNodeIdentity
	owner    *ownership.Lock
}

func randomSecret() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func OpenData(root string) (*Data, error) { return openData(root, true) }

func openData(root string, initialize bool) (*Data, error) {
	absolute, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if !initialize {
		if _, err := os.Lstat(absolute); err != nil {
			return nil, err
		}
	}
	if err := privatefs.EnsureDirectory(absolute); err != nil {
		return nil, fmt.Errorf("protect Local Node root: %w", err)
	}
	owner, err := ownership.Acquire(absolute)
	if err != nil {
		return nil, err
	}
	success := false
	defer func() {
		if !success {
			owner.Release()
		}
	}()
	target := filepath.Join(absolute, identityFile)
	var identity contracts.LocalNodeIdentity
	if _, err := os.Lstat(target); errors.Is(err, os.ErrNotExist) && initialize {
		entries, err := os.ReadDir(absolute)
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			if entry.Name() != ".bridge-owner.lock" {
				return nil, errors.New("Local Node identity is missing from a nonempty data root")
			}
		}
		nodeID, err := randomSecret()
		if err != nil {
			return nil, err
		}
		userID, err := randomSecret()
		if err != nil {
			return nil, err
		}
		secret, err := randomSecret()
		if err != nil {
			return nil, err
		}
		listener, err := net.Listen("tcp4", "127.0.0.1:0")
		if err != nil {
			return nil, err
		}
		port := listener.Addr().(*net.TCPAddr).Port
		if err := listener.Close(); err != nil {
			return nil, err
		}
		identity = contracts.LocalNodeIdentity{SchemaVersion: 1, NodeID: "node_" + nodeID, OwnerUserID: "user_" + userID, Secret: secret, Port: int64(port)}
		encoded, err := json.Marshal(identity)
		if err != nil {
			return nil, err
		}
		if err := privatefs.WriteFile(target, encoded); err != nil {
			return nil, err
		}
	} else {
		encoded, err := privatefs.ReadFile(target, 4096)
		if err != nil {
			return nil, fmt.Errorf("read Local Node identity: %w", err)
		}
		if err := contracts.Decode("LocalNodeIdentity", encoded, &identity); err != nil {
			return nil, err
		}
	}
	if _, err := os.Stat(filepath.Join(absolute, "hub-initialized")); err == nil {
		if info, err := os.Lstat(filepath.Join(absolute, "hub", "hub.sqlite")); err != nil || !info.Mode().IsRegular() {
			return nil, errors.New("initialized Local Node database is missing or unsafe")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	for _, name := range []string{"hub", "bridge"} {
		if err := privatefs.EnsureDirectory(filepath.Join(absolute, name)); err != nil {
			return nil, err
		}
	}
	success = true
	return &Data{Root: absolute, Identity: identity, owner: owner}, nil
}

func (data *Data) Origin() string { return fmt.Sprintf("http://127.0.0.1:%d", data.Identity.Port) }
func (data *Data) Close() error   { return data.owner.Release() }

func (data *Data) MarkInitialized() error {
	target := filepath.Join(data.Root, "hub-initialized")
	if _, err := os.Lstat(target); err == nil {
		_, err := privatefs.ReadFile(target, 64)
		return err
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return privatefs.WriteFile(target, []byte("1\n"))
}
