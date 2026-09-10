package peer

import (
	"context"
	"sync"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

const maximumActivePeerRuns = 8

type peerRunAttempt struct {
	id  string
	err error
}

func (c *Connectors) serveRuns(worker *peerWorker, client *Client, connection *RuntimeConnection) {
	if c.runtime == nil {
		return
	}
	ctx, cancel := context.WithCancel(connection.Context())
	defer cancel()
	partition, err := c.runtime.partitions.Open(worker.local.Receipt.Membership.MembershipID)
	if err != nil {
		c.runError(worker, "PEER_RUN_STORAGE_UNAVAILABLE")
		connection.Close()
		return
	}
	journal := partition.Runs()
	active := map[string]bool{}
	retry := map[string]time.Time{}
	done := make(chan peerRunAttempt, maximumActivePeerRuns)
	var running sync.WaitGroup
	defer running.Wait()
	launch := func(delivery RunDelivery) {
		id := delivery.Settlement.Binding.RunID
		active[id] = true
		running.Add(1)
		go func() {
			defer running.Done()
			execution := &peerRunExecution{factory: c.runtime, client: client, journal: journal,
				membership: worker.local.Receipt.Membership.MembershipID, delivery: delivery}
			err := execution.execute(ctx)
			select {
			case done <- peerRunAttempt{id, err}:
			case <-ctx.Done():
			}
		}()
	}
	ticker := time.NewTicker(c.pollInterval)
	defer ticker.Stop()
	for ctx.Err() == nil {
		records, err := journal.List()
		if err != nil {
			c.runError(worker, "PEER_RUN_STORAGE_UNAVAILABLE")
			connection.Close()
			return
		}
		known := []wire.PeerRunKnown{}
		for _, record := range records {
			delivery, err := record.Delivery()
			if err != nil {
				continue
			} // Historical request-only SDK evidence cannot execute.
			state, err := journal.Transport(record.Binding.RunID)
			if err != nil {
				c.runError(worker, "PEER_RUN_STORAGE_UNAVAILABLE")
				connection.Close()
				return
			}
			closed := state.SettlementReceipt != nil || record.Outcome != nil && record.Outcome.State == "input_required" && state.Acknowledged() == int64(len(state.Events))
			if closed || !after(delivery.Settlement.ExpiresAt, c.clock()) {
				continue
			}
			if len(known) < 128 {
				known = append(known, wire.PeerRunKnown{RunID: record.Binding.RunID, RequestDigest: record.Binding.RequestDigest})
			}
			if !active[record.Binding.RunID] && len(active) < maximumActivePeerRuns && !time.Now().Before(retry[record.Binding.RunID]) {
				launch(delivery)
			}
		}
		if len(active) < maximumActivePeerRuns {
			delivery, err := client.PollRuns(ctx, connection, known)
			if err != nil {
				c.runError(worker, "PEER_RUN_TRANSPORT_UNAVAILABLE")
			} else if delivery != nil && !active[delivery.Settlement.Binding.RunID] {
				if _, err := journal.ReceiveDelivery(*delivery, c.clock()); err != nil {
					c.runError(worker, "PEER_RUN_STORAGE_UNAVAILABLE")
					connection.Close()
					return
				}
				launch(*delivery)
			}
		}
		select {
		case <-ctx.Done():
			return
		case result := <-done:
			delete(active, result.id)
			retry[result.id] = time.Now().Add(c.retryInterval)
			if result.err != nil {
				c.runError(worker, "PEER_RUN_RECOVERY_PENDING")
			} else {
				c.runError(worker, "")
			}
		case <-ticker.C:
		}
	}
}

func (c *Connectors) runError(worker *peerWorker, code string) {
	c.update(worker, func(view *ConnectorStatus) { view.RunError = code })
}

// Recovery belongs to the core lifetime, so a left/expired membership does not
// erase an already known outcome. It never starts an adapter or borrows human
// access. Pending content still passes the normal current-authority path.
func (c *Connectors) recoverRuns(ctx context.Context) {
	if c.runtime == nil {
		return
	}
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	active := map[string]chan struct{}{}
	var running sync.WaitGroup
	defer running.Wait()
	for ctx.Err() == nil {
		state, err := c.store.Read()
		if err == nil && c.checkIdentity() == nil {
			for _, local := range state.Connections {
				id := local.Receipt.Membership.PeerID
				if done := active[id]; done != nil {
					select {
					case <-done:
						delete(active, id)
					default:
						continue
					}
				}
				done := make(chan struct{})
				active[id] = done
				running.Add(1)
				go func() { defer running.Done(); defer close(done); c.recoverPeerRuns(ctx, local) }()
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (c *Connectors) recoverPeerRuns(ctx context.Context, local LocalConnection) {
	partition, err := c.runtime.partitions.Open(local.Receipt.Membership.MembershipID)
	if err != nil {
		return
	}
	records, err := partition.Runs().List()
	if err != nil || len(records) == 0 {
		return
	}
	client, err := c.newClient(local.Receipt.Invitation.HostOrigin, wire.PeerNodeIdentity(local.Receipt.Invitation.Host))
	if err != nil {
		return
	}
	defer client.Close()
	if client.beforeOperation == nil {
		client.beforeOperation = c.checkIdentity
	}
	for _, record := range records {
		if ctx.Err() != nil {
			return
		}
		delivery, err := record.Delivery()
		if err != nil || !after(delivery.Settlement.ExpiresAt, c.clock()) {
			continue
		}
		if record.Outcome == nil && record.StartedAt == "" && (local.State != "active" || !after(local.Receipt.Membership.ExpiresAt, c.clock())) {
			record, err = partition.Runs().Finish(record.Binding.RunID, RunOutcome{State: "delivery_denied"}, c.clock())
			if err != nil {
				continue
			}
		}
		if record.Outcome == nil {
			continue
		}
		execution := &peerRunExecution{factory: c.runtime, client: client, journal: partition.Runs(), membership: local.Receipt.Membership.MembershipID, delivery: delivery}
		_ = execution.recover(ctx, record)
	}
}
