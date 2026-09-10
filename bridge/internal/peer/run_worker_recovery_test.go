package peer

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

func configureRunWorker(c *Connectors, client *Client, f *peerHTTPFixture) {
	c.pollInterval, c.retryInterval = 100*time.Millisecond, 100*time.Millisecond
	c.newClient = func(origin string, host wire.PeerNodeIdentity) (*Client, error) {
		value, err := NewClient(origin, host, client.signer, f.roots)
		if err == nil {
			value.clock = c.clock
		}
		return value, err
	}
}

func startRunWorker(t *testing.T, c *Connectors) func() {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); _ = c.Run(ctx) }()
	stop := func() {
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("Peer worker did not drain its children")
		}
	}
	t.Cleanup(stop)
	return stop
}

func awaitRunWorker(t *testing.T, description string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal(description)
}

func assertRunSettledOnce(t *testing.T, f *peerHTTPFixture, partition *RuntimePartition, id, state string) {
	t.Helper()
	awaitRunWorker(t, "Run did not retain a settlement receipt: "+id, func() bool {
		record, err := partition.Runs().Load(id)
		transport, transportErr := partition.Runs().Transport(id)
		return err == nil && transportErr == nil && record.Outcome != nil && record.Outcome.State == state && transport.SettlementReceipt != nil
	})
	var result struct {
		State                        string
		Events, Replies, Settlements int
	}
	f.controlResult(t, map[string]any{"action": "run-state", "runId": id}, &result)
	want, replies := state, 0
	if state == "completed" {
		replies = 1
	}
	if state == "delivery_denied" {
		want = "canceled"
	}
	if result.State != want || result.Settlements != 1 || result.Replies != replies {
		t.Fatalf("Host retained wrong or duplicate outcome: %+v", result)
	}
}

func TestPeerRunWorkerBoundsConcurrentDeliveryAndSerializesTheWorkspace(t *testing.T) {
	f, client, c, partition, binding := runExecutionFixture(t, "generic-controlled")
	ids := []string{binding.RunID}
	for len(ids) < maximumActivePeerRuns+1 {
		var value struct{ Request json.RawMessage }
		f.controlResult(t, map[string]any{"action": "create-run"}, &value)
		var request struct{ Binding wire.PeerExecutionBinding }
		if wire.VerifyRunRequest(value.Request) != nil || wire.Decode("PeerRunRequest", value.Request, &request) != nil {
			t.Fatal("new Host request did not verify")
		}
		ids = append(ids, request.Binding.RunID)
	}
	configureRunWorker(c, client, f)
	stop := startRunWorker(t, c)
	defer func() {
		if !t.Failed() {
			return
		}
		t.Log("worker", c.Snapshot())
		records, err := partition.Runs().List()
		t.Log("journal count/error", len(records), err)
		for _, record := range records {
			t.Log("Run", record.Binding.RunID, record.StartedAt, record.Outcome)
		}
	}()
	source, _ := c.sources.Resolve(binding.LocalAgentID)
	awaitRunWorker(t, "worker failed to fill its bounded window", func() bool {
		records, err := partition.Runs().List()
		return err == nil && len(records) == maximumActivePeerRuns
	})
	// Let further poll opportunities pass while one child holds the physical
	// resource. Other received Runs cannot begin or expand the delivery window.
	time.Sleep(3 * c.pollInterval)
	records, err := partition.Runs().List()
	if err != nil || len(records) != maximumActivePeerRuns {
		t.Fatal("worker exceeded its concurrent delivery bound", len(records), err)
	}
	started, denied := 0, ""
	for _, record := range records {
		if record.StartedAt != "" {
			started++
		} else {
			denied = record.Binding.RunID
		}
	}
	if started != 1 || denied == "" {
		t.Fatal("queued Runs claimed execution before the shared resource", started)
	}
	f.control(t, map[string]any{"action": "cancel-run", "runId": denied})
	if err := os.WriteFile(filepath.Join(source.Configuration.Workspace, "runtime-release"), []byte("release"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		state := "completed"
		if id == denied {
			state = "delivery_denied"
		}
		assertRunSettledOnce(t, f, partition, id, state)
	}
	stop()
	marker, err := os.ReadFile(filepath.Join(source.Configuration.Workspace, "runtime-started"))
	if err != nil || strings.Count(string(marker), "started\n") != len(ids)-1 {
		t.Fatal("canceled or duplicate Run started a native child", string(marker), err)
	}
	if _, err := os.Stat(filepath.Join(source.Configuration.Workspace, "runtime-overlapped")); !os.IsNotExist(err) {
		t.Fatal("multiple children overlapped in the shared Workspace")
	}
}

func TestPeerRunWorkerRecoversConnectionAndCoreReplacementWithoutReplay(t *testing.T) {
	for _, mode := range []string{"drop-runtime", "restart-host", "restart-participant"} {
		t.Run(mode, func(t *testing.T) {
			f, client, c, partition, binding := runExecutionFixture(t, "generic-hold")
			configureRunWorker(c, client, f)
			stop := startRunWorker(t, c)
			source, _ := c.sources.Resolve(binding.LocalAgentID)
			awaitRunWorker(t, "native child did not start", func() bool {
				_, err := os.Stat(filepath.Join(source.Configuration.Workspace, "runtime-started"))
				return err == nil
			})
			if mode == "restart-participant" {
				stop()
				replacement, err := NewConnectors(c.store, c.sources, client.signer, func() error { return nil })
				if err != nil {
					t.Fatal(err)
				}
				replacement.clock = c.clock
				partitions, err := NewRuntimePartitions(filepath.Dir(c.store.directory), c.store, func() error { return nil })
				if err != nil {
					t.Fatal(err)
				}
				if err := replacement.BindRuntime(partitions, c.runtime.gate, c.runtime.processes); err != nil {
					t.Fatal(err)
				}
				partition, err = partitions.Open(partition.receipt.MembershipID)
				if err != nil {
					t.Fatal(err)
				}
				configureRunWorker(replacement, client, f)
				stop = startRunWorker(t, replacement)
			} else {
				f.control(t, map[string]any{"action": mode})
			}
			assertRunSettledOnce(t, f, partition, binding.RunID, "canceled")
			stop()
			marker, err := os.ReadFile(filepath.Join(source.Configuration.Workspace, "runtime-started"))
			if err != nil || string(marker) != "started\n" {
				t.Fatal("recovered Run repeated its native side effect", string(marker), err)
			}
			probe, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			release, err := c.runtime.gate.Acquire(probe, binding.LocalAgentID)
			if err != nil {
				t.Fatal("confirmed child termination retained its resource", err)
			}
			release()
		})
	}
}
