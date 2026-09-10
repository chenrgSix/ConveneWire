package console

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/peer"
	"convenewire.dev/bridge/internal/privatefs"
	localwire "convenewire.dev/contracts/generated/go/localnode"
)

type consoleExportOwner struct {
	*consolePeerOwner
	store   *peer.Store
	changes atomic.Int32
}

func (p *consoleExportOwner) PeerExports(cfg config.Config) (*peer.Exporter, *peer.Sources, error) {
	sources, err := peer.NewSources(cfg.Agents, map[string]string{"Local writer": "agent_ownershare001"})
	if err != nil {
		return nil, nil, err
	}
	exporter, err := peer.NewExporter(p.store, sources.Resolve)
	return exporter, sources, err
}
func (p *consoleExportOwner) PeerWithdrawal() (*peer.Exporter, error) {
	return peer.NewExporter(p.store, func(string) (peer.ExportSource, error) { return peer.ExportSource{}, peer.ErrExport })
}
func (p *consoleExportOwner) PeerAuthorizationChanged(string) { p.changes.Add(1) }

func peerExportConsoleFixture(t *testing.T) (*Service, *consoleExportOwner, *httptest.Server, peer.State) {
	t.Helper()
	service, approvals, server := peerConsoleFixture(t)
	raw, err := os.ReadFile("../../../packages/contracts/test/fixtures/peer-join.json")
	if err != nil {
		t.Fatal(err)
	}
	var data struct{ State peer.State }
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatal(err)
	}
	state := data.State
	receipt := &state.Connections[0].Receipt
	now := time.Now().UTC().Truncate(time.Millisecond)
	format := "2006-01-02T15:04:05.000Z"
	signer, err := peer.NewLocalSigner(localwire.LocalNodeIdentity{SchemaVersion: 1, NodeID: receipt.Membership.HostNodeID,
		OwnerUserID: "user_consolehost001", Port: 48295, Secret: strings.Repeat("B", 42) + "A"})
	if err != nil {
		t.Fatal(err)
	}
	receipt.Invitation.Host.PublicKey = signer.Identity().PublicKey
	receipt.Membership.CreatedAt = now.Format(format)
	receipt.Membership.ExpiresAt = now.Add(24 * time.Hour).Format(format)
	receipt.Invitation.ExpiresAt = now.Add(time.Hour).Format(format)
	receipt.Invitation.MembershipExpiresAt = receipt.Membership.ExpiresAt
	receipt.MachineCredential.ExpiresAt = receipt.Membership.ExpiresAt
	digest, err := peer.JoinReceiptDigest(*receipt)
	if err != nil {
		t.Fatal(err)
	}
	nonce, _ := peer.NewNonce()
	receipt.Proof, err = signer.Sign(peer.ProofContext{Purpose: "invitation.claim", AudienceNodeID: state.Participant.NodeID,
		OperationID: "op_consolejoin001", Nonce: nonce, SubjectDigest: digest}, now)
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(t.TempDir(), "peer-owner")
	if err := privatefs.CreateDirectory(root); err != nil {
		t.Fatal(err)
	}
	store, err := peer.OpenStore(root, state.Participant, state.LocalUserID)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Update(0, state, now); err != nil {
		t.Fatal(err)
	}
	owner := &consoleExportOwner{consolePeerOwner: approvals, store: store}
	service.mu.Lock()
	service.options.NativePeers = owner
	service.configuration = &config.Config{LocalNodeID: state.Participant.NodeID, DataDir: service.options.DataDir, Agents: []config.AgentConfig{{
		Name: "Local writer", Role: "Reviewer", Adapter: "generic", RuntimeKind: "generic", PresetVersion: 1, Command: []string{"offline-runtime"}, Workspace: t.TempDir(),
	}}}
	service.mu.Unlock()
	return service, owner, server, state
}

func TestPeerConsoleExportRequiresReviewedConfigurationAndWithdrawsWithoutRuntime(t *testing.T) {
	service, owner, server, state := peerExportConsoleFixture(t)
	response := consoleRequest(t, server.URL, service.Token(), http.MethodGet, "/api/peers/exports", nil)
	var inventory struct {
		State   peer.OwnerState
		Sources []peer.SourceReview
	}
	err := json.NewDecoder(response.Body).Decode(&inventory)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || len(inventory.Sources) != 1 || !inventory.Sources[0].Available {
		t.Fatal("native export review", err, response.StatusCode)
	}
	source := inventory.Sources[0]
	membership := state.Connections[0].Receipt.Membership
	request := peer.ExportRequest{MembershipID: membership.MembershipID, LocalAgentID: source.LocalAgentID, OperationID: "op_consoleshare001",
		RoomIDs: []string{*membership.Scope.RoomID}, Capabilities: source.Capabilities, ExpiresAt: membership.ExpiresAt}
	payload := map[string]any{"expectedRevision": inventory.State.Revision, "configurationDigest": source.ConfigurationDigest, "request": request}
	response = consoleRequest(t, server.URL, "peer-machine-token", http.MethodPost, "/api/peers/exports", payload)
	response.Body.Close()
	if response.StatusCode != 401 {
		t.Fatal("Peer machine granted local export")
	}
	payload["configurationDigest"] = strings.Repeat("0", 64)
	response = consoleRequest(t, server.URL, service.Token(), http.MethodPost, "/api/peers/exports", payload)
	response.Body.Close()
	if response.StatusCode != 409 {
		t.Fatal("unreviewed configuration exported")
	}
	payload["configurationDigest"] = source.ConfigurationDigest
	service.mu.Lock()
	service.configuration.Agents[0].Command[0] = "different-runtime"
	service.mu.Unlock()
	response = consoleRequest(t, server.URL, service.Token(), http.MethodPost, "/api/peers/exports", payload)
	response.Body.Close()
	if response.StatusCode != 409 {
		t.Fatal("stale review silently accepted new executable")
	}
	service.mu.Lock()
	service.configuration.Agents[0].Command[0] = "offline-runtime"
	service.mu.Unlock()
	response = consoleRequest(t, server.URL, service.Token(), http.MethodPost, "/api/peers/exports", payload)
	var entry peer.LocalExport
	err = json.NewDecoder(response.Body).Decode(&entry)
	response.Body.Close()
	if err != nil || response.StatusCode != 201 || entry.ConfigurationDigest != source.ConfigurationDigest || owner.changes.Load() != 1 {
		t.Fatal("reviewed export not persisted", err, response.StatusCode)
	}
	saved, err := owner.store.Read()
	if err != nil || saved.Revision != inventory.State.Revision+1 || len(saved.Connections[0].LocalExports) != 1 {
		t.Fatal("export not durable", err)
	}
	// Even a missing configuration and an ongoing core replacement cannot
	// remove the Participant's ability to revoke an existing local grant.
	service.mu.Lock()
	service.configuration = nil
	service.bridgeRestartPending = true
	service.mu.Unlock()
	withdrawal := map[string]any{"expectedRevision": saved.Revision, "membershipId": membership.MembershipID, "exportId": entry.Offer.Grant.ExportID,
		"grantRevision": entry.Offer.Grant.Revision, "operationId": "op_consolewithdraw001"}
	response = consoleRequest(t, server.URL, service.Token(), http.MethodPost, "/api/peers/exports/withdraw", withdrawal)
	err = json.NewDecoder(response.Body).Decode(&entry)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || entry.Offer.Grant.State != "revoked" || owner.changes.Load() != 2 {
		t.Fatal("offline local withdrawal blocked", err, response.StatusCode)
	}
	saved, _ = owner.store.Read()
	revision := saved.Revision
	response = consoleRequest(t, server.URL, service.Token(), http.MethodPost, "/api/peers/exports/withdraw", withdrawal)
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("withdrawal retry rejected")
	}
	saved, _ = owner.store.Read()
	if saved.Revision != revision {
		t.Fatal("withdrawal retry created another revision")
	}
}
