package bridgecore

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"

	"convenewire.dev/bridge/internal/admission"
	"convenewire.dev/bridge/internal/authority"
	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/delivery"
	"convenewire.dev/bridge/internal/pairing"
	"convenewire.dev/bridge/internal/peer"
	"convenewire.dev/bridge/internal/privatefs"
	localwire "convenewire.dev/contracts/generated/go/localnode"
)

var errNativeNode = errors.New("native Runtime ownership no longer matches this installation")

// NativeNode is supplied only by the native shell while it holds the installation
// lease. The Console owns the separate Bridge lease; neither a Device profile
// nor an HTTP request can provide this native signing identity.
type NativeNode struct {
	root                   string
	identity               localwire.LocalNodeIdentity
	signer                 *peer.Signer
	store                  *peer.Store
	storeOnce              sync.Once
	storeErr               error
	partitionOnce          sync.Once
	partitions             *peer.RuntimePartitions
	partitionError         error
	peerMu                 sync.Mutex
	peers                  *peer.Connectors
	peerError              string
	closed                 atomic.Bool
	ownerMu                sync.Mutex
	ownerAccess            *peer.OwnerAccess
	ownerAccessError       error
	ownerAccessInitialized bool
	departures             *peer.Departure
	departureError         error
	departureInitialized   bool
}

func NewNativeNode(root string, identity localwire.LocalNodeIdentity) (*NativeNode, error) {
	if !filepath.IsAbs(root) || filepath.Clean(root) != root {
		return nil, errNativeNode
	}
	signer, err := peer.NewLocalSigner(identity)
	if err != nil {
		return nil, errNativeNode
	}
	node := &NativeNode{root: root, identity: identity, signer: signer}
	if err := node.checkIdentity(); err != nil {
		return nil, err
	}
	return node, nil
}

func (n *NativeNode) checkIdentity() error {
	if n == nil || n.signer == nil || n.closed.Load() {
		return errNativeNode
	}
	raw, err := privatefs.ReadFile(filepath.Join(n.root, "identity.json"), 4096)
	var current localwire.LocalNodeIdentity
	if err != nil || localwire.Decode("LocalNodeIdentity", raw, &current) != nil || current != n.identity {
		return errNativeNode
	}
	return nil
}

func (n *NativeNode) check() error {
	return n.checkIdentity()
}

// Peer storage belongs to the Peer subsystem. Its failure must not stop an
// otherwise valid Device connector. Keep one store handle for the shell's
// lifetime so reopening a core cannot forget observed history or rollback.
func (n *NativeNode) peerStore() (*peer.Store, error) {
	if err := n.checkIdentity(); err != nil {
		return nil, err
	}
	n.storeOnce.Do(func() {
		n.store, n.storeErr = peer.OpenStore(n.root, n.signer.Identity(), n.signer.LocalUserID())
	})
	if n.storeErr != nil {
		return nil, n.storeErr
	}
	if _, err := n.store.Read(); err != nil {
		return nil, err
	}
	return n.store, nil
}

func (n *NativeNode) peerPartitions() (*peer.RuntimePartitions, error) {
	store, err := n.peerStore()
	if err != nil {
		return nil, err
	}
	n.partitionOnce.Do(func() {
		n.partitions, n.partitionError = peer.NewRuntimePartitions(n.root, store, n.checkIdentity)
	})
	return n.partitions, n.partitionError
}

type nativeNodeContextKey struct{}

func WithNativeNode(ctx context.Context, node *NativeNode) context.Context {
	return context.WithValue(ctx, nativeNodeContextKey{}, node)
}

func nativeNodeFromContext(ctx context.Context) *NativeNode {
	node, _ := ctx.Value(nativeNodeContextKey{}).(*NativeNode)
	return node
}

type nativeResources struct {
	shared    *delivery.ResourceGate
	primary   *delivery.MappedExecutionGate
	processes *admission.GovernedProcessStore
}

// Recover all retained Device partitions before opening the Node process store,
// even if their configuration has been removed or their Host cannot be reached.
func openNativeResources(ctx context.Context, node *NativeNode, cfg config.Config, credential pairing.Credential,
	identities map[string]string) (*nativeResources, error) {
	if err := node.checkConfiguration(cfg); err != nil {
		return nil, err
	}
	if credential.ServerURL != cfg.ServerURL {
		return nil, errNativeNode
	}
	owner := admission.Owner{ServerURL: credential.ServerURL, TeamID: credential.TeamID, DeviceID: credential.DeviceID, OwnerMemberID: credential.OwnerMemberID}
	partitions := map[string]admission.Owner{cfg.DataDir: owner}
	if _, err := os.Lstat(filepath.Join(cfg.DataDir, "authorities")); err == nil {
		retained, err := authority.OwnedPartitions(cfg.DataDir)
		if err != nil {
			return nil, err
		}
		for _, partition := range retained {
			b := partition.Binding
			bound := admission.Owner{ServerURL: b.Pin.ServerOrigin, TeamID: b.TeamID, DeviceID: b.DeviceID, OwnerMemberID: b.OwnerMemberID}
			if partition.DataDir == cfg.DataDir && bound != owner {
				return nil, errNativeNode
			}
			partitions[partition.DataDir] = bound
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	for root, owner := range partitions {
		if err := fenceDeviceProcesses(ctx, root, owner); err != nil {
			return nil, err
		}
	}
	legacy := filepath.Join(cfg.DataDir, "core-runtime-processes")
	if _, err := os.Lstat(legacy); err == nil {
		if err := fenceDeviceProcesses(ctx, legacy, owner); err != nil {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return openNodeExecutionResources(ctx, node, cfg, identities)
}

func (n *NativeNode) checkConfiguration(cfg config.Config) error {
	if err := n.check(); err != nil {
		return err
	}
	if cfg.LocalNodeID != n.identity.NodeID || cfg.DataDir != filepath.Join(n.root, "bridge") ||
		cfg.ServerURL != fmt.Sprintf("http://127.0.0.1:%d", n.identity.Port) {
		return errNativeNode
	}
	return nil
}

// Paired and unpaired epochs reuse the same physical gate and durable process
// owner. Adding a Device connection cannot select a fresh recovery namespace.
func openNodeExecutionResources(ctx context.Context, node *NativeNode, cfg config.Config,
	identities map[string]string) (*nativeResources, error) {
	shared := &delivery.ResourceGate{}
	primary := &delivery.MappedExecutionGate{Shared: shared, Resources: map[string]delivery.LocalResource{}, Paths: map[string]string{}}
	for _, agent := range cfg.Agents {
		id := identities[agent.Name]
		workspace, err := delivery.CanonicalWorkspace(agent.Workspace)
		if err != nil || id == "" {
			return nil, errNativeNode
		}
		if _, duplicate := primary.Resources[id]; duplicate {
			return nil, errNativeNode
		}
		primary.Resources[id] = delivery.LocalResource{AgentID: id, Workspace: workspace}
		primary.Paths[id] = agent.Workspace
	}
	root := filepath.Join(cfg.DataDir, "core-node-processes")
	if err := privatefs.EnsureDirectory(root); err != nil {
		return nil, err
	}
	processes, err := admission.OpenNodeProcessStore(ctx, root, admission.NodeProcessOwner{SchemaVersion: 1,
		NodeID: node.signer.Identity().NodeID, PublicKey: node.signer.Identity().PublicKey, LocalUserID: node.signer.LocalUserID()})
	if err != nil {
		return nil, err
	}
	if err := processes.FenceAll(ctx); err != nil {
		return nil, errors.Join(err, processes.Close())
	}
	return &nativeResources{shared: shared, primary: primary, processes: processes}, nil
}

func fenceDeviceProcesses(ctx context.Context, root string, owner admission.Owner) error {
	processes, err := admission.OpenGovernedProcessStore(ctx, root, owner)
	if err != nil {
		return err
	}
	return errors.Join(processes.FenceAll(ctx), processes.Close())
}
