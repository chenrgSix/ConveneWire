package peer

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	localwire "convenewire.dev/contracts/generated/go/localnode"
	wire "convenewire.dev/contracts/generated/go/peer"
)

type peerHTTPFixture struct {
	Origin     string                `json:"origin"`
	Host       wire.PeerNodeIdentity `json:"host"`
	Invitation wire.PeerInvitation   `json:"invitation"`
	Secret     string                `json:"secret"`
	roots      *x509.CertPool
	command    *exec.Cmd
	input      io.WriteCloser
	lines      *bufio.Scanner
}

func peerTLSFixture(t *testing.T, now time.Time) *peerHTTPFixture {
	t.Helper()
	directory := t.TempDir()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	cert := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Peer offline fixture"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IPAddresses: []net.IP{net.ParseIP("127.0.0.1")},
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	raw, err := x509.CreateCertificate(rand.Reader, cert, cert, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: raw})
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	certFile, keyFile := filepath.Join(directory, "fixture-cert.pem"), filepath.Join(directory, "fixture-key.pem")
	if err = os.WriteFile(certFile, certPEM, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(keyFile, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}), 0600); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	process := exec.Command("node", "--import", "tsx", "apps/server/test/helpers/peer-http-fixture.ts", directory, certFile, keyFile, now.Format(peerTimeFormat))
	process.Dir = root
	output, err := process.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	input, err := process.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	process.Stderr = &stderr
	if err = process.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	go func() { exited <- process.Wait() }()
	t.Cleanup(func() {
		_, _ = io.WriteString(input, "{\"action\":\"stop\"}\n")
		_ = input.Close()
		select {
		case err := <-exited:
			if err != nil {
				t.Errorf("Peer fixture exit: %v (%s)", err, stderr.String())
			}
		case <-time.After(15 * time.Second):
			_ = process.Process.Kill()
			<-exited
			t.Error("Peer fixture did not drain")
		}
	})
	scanner := bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	ready := make(chan bool, 1)
	go func() { ready <- scanner.Scan() }()
	select {
	case ok := <-ready:
		if !ok {
			t.Fatalf("Peer fixture startup: %s", stderr.String())
		}
	case <-time.After(30 * time.Second):
		_ = process.Process.Kill()
		t.Fatal("Peer fixture startup timeout")
	}
	var f peerHTTPFixture
	if err = json.Unmarshal(scanner.Bytes(), &f); err != nil {
		t.Fatal("invalid Peer fixture readiness")
	}
	f.roots = x509.NewCertPool()
	if !f.roots.AppendCertsFromPEM(certPEM) {
		t.Fatal("fixture CA")
	}
	f.command = process
	f.input = input
	f.lines = scanner
	return &f
}
func (f *peerHTTPFixture) control(t *testing.T, value any) map[string]int {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.input.Write(append(raw, '\n')); err != nil {
		t.Fatal(err)
	}
	read := make(chan bool, 1)
	go func() { read <- f.lines.Scan() }()
	select {
	case ok := <-read:
		if !ok {
			t.Fatal("Peer fixture stopped")
		}
	case <-time.After(15 * time.Second):
		t.Fatal("Peer fixture control timeout")
	}
	var result map[string]int
	if json.Unmarshal(f.lines.Bytes(), &result) != nil {
		t.Fatal("Peer fixture control output")
	}
	return result
}
func TestGoParticipantJoinsRealServerOverTLSAndRecoversLostClaimResponse(t *testing.T) {
	now := time.Date(2026, 9, 10, 2, 0, 0, 0, time.UTC)
	f := peerTLSFixture(t, now)
	identity := localwire.LocalNodeIdentity{SchemaVersion: 1, NodeID: "node_tlsclient001", OwnerUserID: "user_tlsclient001", Port: 40381, Secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}
	signer, err := NewLocalSigner(identity)
	if err != nil {
		t.Fatal(err)
	}
	client, err := NewClient(f.Origin, f.Host, signer, f.roots)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	client.clock = func() time.Time { return now }
	rejected, err := NewClient(f.Origin, f.Host, signer, nil)
	if err != nil {
		t.Fatal(err)
	}
	rejected.clock = client.clock
	if _, err = rejected.Preview(context.Background(), f.Invitation.InvitationID, f.Secret, "op_untrustedca001"); err == nil {
		t.Fatal("untrusted private CA accepted")
	}
	rejected.Close()
	wrongHost := f.Host
	wrongHost.PublicKey = signer.Identity().PublicKey
	wrong, err := NewClient(f.Origin, wrongHost, signer, f.roots)
	if err != nil {
		t.Fatal(err)
	}
	wrong.clock = client.clock
	if _, err = wrong.Preview(context.Background(), f.Invitation.InvitationID, f.Secret, "op_wronghost001"); err == nil {
		t.Fatal("wrong pinned Node key accepted")
	}
	wrong.Close()
	if count := f.control(t, map[string]any{"action": "stats"}); count["previewRequests"] != 0 {
		t.Fatal("invitation secret sent before Host proof validation")
	}
	operation := "op_tlsclientclaim001"
	preview, err := client.Preview(context.Background(), f.Invitation.InvitationID, f.Secret, operation)
	if err != nil {
		t.Fatal("preview", err)
	}
	store, root := newStore(t, State{Participant: signer.Identity(), LocalUserID: signer.LocalUserID()})
	human, err := OpenHumanVault(root, store)
	if err != nil {
		t.Fatal(err)
	}
	journal, err := OpenJoinJournal(store, human)
	if err != nil {
		t.Fatal(err)
	}
	pending := PendingJoin{SchemaVersion: 1, Participant: signer.Identity(), LocalUserID: signer.LocalUserID(), Invitation: preview.Invitation,
		Secret: f.Secret, OperationID: operation, DisplayName: "独立参与者", PreviewProof: preview.Proof, CreatedAt: now.Format(peerTimeFormat)}
	if err = journal.Save(pending, now); err != nil {
		t.Fatal(err)
	}
	if _, err = client.ClaimPending(context.Background(), journal, operation); err == nil {
		t.Fatal("lost claim response was treated as success")
	}
	if count := f.control(t, map[string]any{"action": "stats"}); count["memberships"] != 1 {
		t.Fatal("Host claim not committed", count)
	}
	if _, err = journal.Load(operation); err != nil {
		t.Fatal("pending intent lost", err)
	}
	restored, err := OpenStore(root, signer.Identity(), signer.LocalUserID())
	if err != nil {
		t.Fatal(err)
	}
	human, err = OpenHumanVault(root, restored)
	if err != nil {
		t.Fatal(err)
	}
	journal, err = OpenJoinJournal(restored, human)
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := client.ClaimPending(context.Background(), journal, operation)
	if err != nil {
		t.Fatal("fresh exact retry", err)
	}
	if count := f.control(t, map[string]any{"action": "stats"}); count["memberships"] != 1 {
		t.Fatal("duplicate Member on retry", count)
	}
	source := fixtureExportSource()
	exporter, err := NewExporter(restored, func(string) (ExportSource, error) { return source, nil })
	if err != nil {
		t.Fatal(err)
	}
	state, err := restored.Read()
	if err != nil {
		t.Fatal(err)
	}
	exportRequest := fixtureExportRequest(state, source)
	prepared, err := exporter.Prepare(state.Revision, exportRequest, now)
	if err != nil {
		t.Fatal("prepare export", err)
	}
	if _, err := client.PublishExport(context.Background(), exporter, exportRequest.MembershipID, source.AgentID); !errors.Is(err, ErrTransport) {
		t.Fatal("lost offer response was treated as a receipt", err)
	}
	if count := f.control(t, map[string]any{"action": "stats"}); count["offers"] != 1 || count["acceptances"] != 0 {
		t.Fatal("offer authority", count)
	}
	reopened, err := OpenStore(root, signer.Identity(), signer.LocalUserID())
	if err != nil {
		t.Fatal(err)
	}
	exporter, _ = NewExporter(reopened, func(string) (ExportSource, error) { return source, nil })
	offerReceipt, err := client.PublishExport(context.Background(), exporter, exportRequest.MembershipID, source.AgentID)
	if err != nil {
		t.Fatal("retry durable offer", err)
	}
	if offerReceipt.ExportID != prepared.Offer.Grant.ExportID || offerReceipt.GrantRevision != 1 {
		t.Fatal("offer retry changed authorization")
	}
	tampered := prepared.Offer
	tampered.DisplayName = "Unreviewed rename"
	if VerifyOfferReceipt(offerReceipt, tampered, f.Host, signer.Identity(), prepared.OperationID, offerReceipt.Proof.Payload.Nonce, now) == nil {
		t.Fatal("offer receipt metadata substituted")
	}
	roomID := prepared.Offer.Grant.RoomIDS[0]
	if _, err := exporter.Effective(exportRequest.MembershipID, source.AgentID, roomID, now); err == nil {
		t.Fatal("unaccepted offer became executable")
	}
	if count := f.control(t, map[string]any{"action": "accept-agent"}); count["offers"] != 1 || count["acceptances"] != 1 {
		t.Fatal("explicit Host acceptance", count)
	}
	if _, err = client.SyncExports(context.Background(), exporter, exportRequest.MembershipID, source.AgentID, "op_tlsacceptsync001"); !errors.Is(err, ErrTransport) {
		t.Fatal("lost acceptance snapshot response", err)
	}
	reopened, err = OpenStore(root, signer.Identity(), signer.LocalUserID())
	if err != nil {
		t.Fatal(err)
	}
	exporter, _ = NewExporter(reopened, func(string) (ExportSource, error) { return source, nil })
	accepted, err := client.SyncExports(context.Background(), exporter, exportRequest.MembershipID, source.AgentID, "op_tlsacceptsync001")
	if err != nil || len(accepted.AcceptanceHistory) != 1 {
		t.Fatal("acceptance recovery", err)
	}
	firstEffective, err := exporter.Effective(exportRequest.MembershipID, source.AgentID, roomID, now)
	if err != nil {
		t.Fatal("verified bilateral authorization", err)
	}
	f.control(t, map[string]any{"action": "revoke-agent"})
	if _, err := client.SyncExports(context.Background(), exporter, exportRequest.MembershipID, source.AgentID, "op_tlsrevokesync001"); err != nil {
		t.Fatal(err)
	}
	if _, err := exporter.Effective(exportRequest.MembershipID, source.AgentID, roomID, now); err == nil {
		t.Fatal("Host revoke ignored")
	}
	f.control(t, map[string]any{"action": "accept-agent"})
	if _, err := client.SyncExports(context.Background(), exporter, exportRequest.MembershipID, source.AgentID, "op_tlsnewsync001"); err != nil {
		t.Fatal(err)
	}
	effective, err := exporter.Effective(exportRequest.MembershipID, source.AgentID, roomID, now)
	if err != nil || effective.Projection.ProjectionAgentID != firstEffective.Projection.ProjectionAgentID || effective.Acceptance.AcceptanceID == firstEffective.Acceptance.AcceptanceID {
		t.Fatal("new acceptance did not preserve mapping", err)
	}
	source.Configuration.Role = "Revised while offline"
	exportRequest.OperationID = "op_tlsexportrevision002"
	state, err = reopened.Read()
	if err != nil {
		t.Fatal(err)
	}
	revised, err := exporter.Prepare(state.Revision, exportRequest, now)
	if err != nil {
		t.Fatal("offline revision", err)
	}
	state, err = reopened.Read()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = exporter.Withdraw(state.Revision, exportRequest.MembershipID, revised.Offer.Grant.ExportID, 2, "op_tlswithdraw001", now); err != nil {
		t.Fatal("offline withdrawal", err)
	}
	exporter, _ = NewExporter(reopened, func(string) (ExportSource, error) { return ExportSource{}, ErrExport })
	syncOperation := "op_tlsexportsync001"
	if _, err = client.SyncExports(context.Background(), exporter, exportRequest.MembershipID, source.AgentID, syncOperation); err != nil {
		t.Fatal("withdrawal sync", err)
	}
	if count := f.control(t, map[string]any{"action": "stats"}); count["offers"] != 3 || count["enabledPeers"] != 0 {
		t.Fatal("atomic withdrawal", count)
	}
	reopened, err = OpenStore(root, signer.Identity(), signer.LocalUserID())
	if err != nil {
		t.Fatal(err)
	}
	exporter, _ = NewExporter(reopened, func(string) (ExportSource, error) { return ExportSource{}, ErrExport })
	synchronized, err := client.SyncExports(context.Background(), exporter, exportRequest.MembershipID, source.AgentID, syncOperation)
	if err != nil || synchronized.GrantRevision != 3 {
		t.Fatal("sync after reopen without Runtime", err)
	}
	if count := f.control(t, map[string]any{"action": "stats"}); count["offers"] != 3 || count["acceptances"] != 3 || count["enabledPeers"] != 0 {
		t.Fatal("sync retry revived authority", count)
	}
	history, err := exporter.History(exportRequest.MembershipID, source.AgentID, now)
	if err != nil {
		t.Fatal(err)
	}
	if VerifyExportSyncReceipt(synchronized, history[:2], receipt.Membership.PeerID, source.AgentID, f.Host, signer.Identity(), syncOperation, synchronized.Proof.Payload.Nonce, now) == nil {
		t.Fatal("sync receipt accepted truncated history")
	}
	entry, err := client.HumanEntry(context.Background(), human, receipt.Membership.MembershipID, wire.PeerScope(receipt.Membership.Scope), "op_tlsbrowser001")
	if err != nil {
		t.Fatal("human entry", err)
	}
	raw, _ := json.Marshal(wire.PeerBrowserEntryRequest{SchemaVersion: 1, CredentialID: entry.Credential.CredentialID, Token: entry.Credential.Token})
	request, err := http.NewRequest(http.MethodPost, f.Origin+"/api/peer/browser-entry/claim", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("content-type", "application/json")
	request.Header.Set("origin", f.Origin)
	response, err := client.http.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil || response.StatusCode != 200 {
		t.Fatalf("scoped browser exchange: %d %s", response.StatusCode, body)
	}
	if len(response.Cookies()) != 1 || !response.Cookies()[0].HttpOnly || !response.Cookies()[0].Secure {
		t.Fatal("scoped cookie missing")
	}
	f.control(t, map[string]any{"action": "revoke", "membershipId": receipt.Membership.MembershipID})
	if _, err = client.HumanEntry(context.Background(), human, receipt.Membership.MembershipID, wire.PeerScope(receipt.Membership.Scope), "op_tlsrevoked001"); err == nil {
		t.Fatal("revoked Host membership renewed human entry")
	}
}
