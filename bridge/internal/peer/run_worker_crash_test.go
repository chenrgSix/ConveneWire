package peer

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/admission"
	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/delivery"
	localwire "convenewire.dev/contracts/generated/go/localnode"
	wire "convenewire.dev/contracts/generated/go/peer"
)

type peerWorkerCrashInput struct {
	Root, Origin, AgentID string
	Agent                 config.AgentConfig
	Host                  wire.PeerNodeIdentity
	Certificate           []byte
	Now                   time.Time
}

// A separate disposable Participant process. Its native adapter child is still
// tracked by the real Node process store when this parent is killed abruptly.
func TestPeerWorkerCrashProcessFixture(t *testing.T) {
	file := os.Getenv("CONVENE_WIRE_PEER_WORKER_CRASH_FIXTURE")
	if file == "" {
		return
	}
	raw, err := os.ReadFile(file)
	var input peerWorkerCrashInput
	if err != nil || json.Unmarshal(raw, &input) != nil {
		t.Fatal("invalid owned crash fixture")
	}
	signer, err := NewLocalSigner(localwire.LocalNodeIdentity{SchemaVersion: 1, NodeID: "node_tlsruntime001", OwnerUserID: "user_tlsruntime001",
		Port: 40391, Secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
	if err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(input.Root, signer.Identity(), signer.LocalUserID())
	if err != nil {
		t.Fatal(err)
	}
	sources, err := NewSources([]config.AgentConfig{input.Agent}, map[string]string{input.Agent.Name: input.AgentID})
	if err != nil {
		t.Fatal(err)
	}
	c, err := NewConnectors(store, sources, signer, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	c.clock = func() time.Time { return input.Now }
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(input.Certificate) {
		t.Fatal("invalid fixture certificate")
	}
	c.newClient = func(origin string, host wire.PeerNodeIdentity) (*Client, error) {
		client, err := NewClient(origin, host, signer, roots)
		if err == nil {
			client.clock = c.clock
		}
		return client, err
	}
	partitions, err := NewRuntimePartitions(input.Root, store, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	processes, err := admission.OpenNodeProcessStore(context.Background(), filepath.Join(input.Root, "node-processes"), admission.NodeProcessOwner{
		SchemaVersion: 1, NodeID: signer.Identity().NodeID, PublicKey: signer.Identity().PublicKey, LocalUserID: signer.LocalUserID()})
	if err != nil {
		t.Fatal(err)
	}
	defer processes.Close()
	if err := processes.FenceAll(context.Background()); err != nil {
		t.Fatal(err)
	}
	workspace, err := delivery.CanonicalWorkspace(input.Agent.Workspace)
	if err != nil {
		t.Fatal(err)
	}
	gate := &delivery.MappedExecutionGate{Shared: &delivery.ResourceGate{},
		Resources: map[string]delivery.LocalResource{input.AgentID: {AgentID: input.AgentID, Workspace: workspace}},
		Paths:     map[string]string{input.AgentID: input.Agent.Workspace}}
	if err := c.BindRuntime(partitions, gate, processes); err != nil {
		t.Fatal(err)
	}
	if err := c.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestPeerRunWorkerFencesAnAbruptParticipantCrashBeforeUnknownSettlement(t *testing.T) {
	f, client, old, partition, binding := runExecutionFixture(t, "generic-hold")
	root := filepath.Dir(old.store.directory)
	source, _ := old.sources.Resolve(binding.LocalAgentID)
	if err := old.runtime.processes.(*admission.GovernedProcessStore).Close(); err != nil {
		t.Fatal(err)
	}
	input := peerWorkerCrashInput{Root: root, Origin: f.Origin, Host: f.Host, AgentID: binding.LocalAgentID,
		Agent: source.Configuration, Certificate: f.certificatePEM, Now: old.clock()}
	raw, _ := json.Marshal(input)
	file := filepath.Join(t.TempDir(), "worker.json")
	if err := os.WriteFile(file, raw, 0600); err != nil {
		t.Fatal(err)
	}
	child := exec.Command(os.Args[0], "-test.run=^TestPeerWorkerCrashProcessFixture$")
	child.Env = append(os.Environ(), "CONVENE_WIRE_PEER_WORKER_CRASH_FIXTURE="+file)
	var output bytes.Buffer
	child.Stdout, child.Stderr = &output, &output
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { defer close(done); _ = child.Wait() }()
	var stopOnce sync.Once
	stop := func() { stopOnce.Do(func() { _ = child.Process.Kill(); <-done }) }
	var processes *admission.GovernedProcessStore
	openAndFence := func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		var err error
		processes, err = admission.OpenNodeProcessStore(ctx, filepath.Join(root, "node-processes"), admission.NodeProcessOwner{
			SchemaVersion: 1, NodeID: client.signer.Identity().NodeID, PublicKey: client.signer.Identity().PublicKey, LocalUserID: client.signer.LocalUserID()})
		if err != nil {
			return err
		}
		return processes.FenceAll(ctx)
	}
	t.Cleanup(func() {
		stop()
		if processes == nil {
			if err := openAndFence(); err != nil {
				t.Error("failed to drain owned crash-fixture descendants", err)
			}
		}
		if processes != nil {
			_ = processes.Close()
		}
		if t.Failed() {
			t.Log("Participant fixture output", output.String())
		}
	})
	awaitRunWorker(t, "separate Participant did not start its native child", func() bool {
		_, err := os.Stat(filepath.Join(source.Configuration.Workspace, "runtime-started"))
		return err == nil
	})
	stop()
	record, err := partition.Runs().Load(binding.RunID)
	if err != nil || record.StartedAt == "" || record.Outcome != nil {
		t.Fatal("crash did not leave durable possible-start evidence", err)
	}
	// Production native startup fences this same Node process store before
	// creating a replacement core. No recovered Run is admitted before it.
	if err := openAndFence(); err != nil {
		t.Fatal("native orphan fencing", err)
	}
	replacement, err := NewConnectors(old.store, old.sources, client.signer, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	replacement.clock = old.clock
	partitions, err := NewRuntimePartitions(root, old.store, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if err := replacement.BindRuntime(partitions, old.runtime.gate, processes); err != nil {
		t.Fatal(err)
	}
	partition, err = partitions.Open(partition.receipt.MembershipID)
	if err != nil {
		t.Fatal(err)
	}
	configureRunWorker(replacement, client, f)
	stopWorker := startRunWorker(t, replacement)
	assertRunSettledOnce(t, f, partition, binding.RunID, "outcome_unknown")
	stopWorker()
	marker, err := os.ReadFile(filepath.Join(source.Configuration.Workspace, "runtime-started"))
	if err != nil || string(marker) != "started\n" {
		t.Fatal("possible-start recovery repeated the native child", string(marker), err)
	}
}
