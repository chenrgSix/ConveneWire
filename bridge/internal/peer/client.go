package peer

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

var ErrTransport = errors.New("Peer endpoint request failed; retain the original operation for recovery")

type RemoteError struct{ Code string }

func (e *RemoteError) Error() string { return "Peer endpoint denied operation: " + e.Code }

type Client struct {
	origin    string
	host      wire.PeerNodeIdentity
	signer    *Signer
	http      *http.Client
	transport *http.Transport
	clock     func() time.Time
	// The native core revalidates its installation before every network action.
	// Kept local; it is never configurable by the Host or included in a request.
	beforeOperation func() error
}

// NewClient uses normal hostname/CA verification (or explicitly supplied private
// roots), no cookies, no redirects and no inherited Device/server credentials.
func NewClient(origin string, host wire.PeerNodeIdentity, signer *Signer, roots *x509.CertPool) (*Client, error) {
	if ValidateOrigin(origin) != nil || !closed("PeerNodeIdentity", host) || signer == nil || !closed("PeerNodeIdentity", signer.Identity()) || host.NodeID == signer.Identity().NodeID {
		return nil, ErrProof
	}
	transport := &http.Transport{
		DialContext:       (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		ForceAttemptHTTP2: true, MaxIdleConns: 8, IdleConnTimeout: 30 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second, ExpectContinueTimeout: time.Second,
		TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
	}
	if roots != nil {
		transport.TLSClientConfig.RootCAs = roots.Clone()
	}
	client := &http.Client{Transport: transport, Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return &Client{origin: origin, host: host, signer: signer, http: client, transport: transport, clock: time.Now}, nil
}
func (c *Client) Close() { c.transport.CloseIdleConnections() }
func (c *Client) checkLocal() error {
	if c.beforeOperation != nil {
		return c.beforeOperation()
	}
	return nil
}
func (c *Client) identity(ctx context.Context, operationID string) error {
	nonce, err := NewNonce()
	if err != nil {
		return err
	}
	request := map[string]any{"schemaVersion": 1, "participant": c.signer.Identity(), "operationId": operationID, "nonce": nonce}
	var identity IdentityProof
	if err = c.post(ctx, "/api/peer/identity", "PeerIdentityRequest", request, "PeerIdentityProof", &identity); err != nil {
		return err
	}
	return VerifyIdentityProof(identity, c.host, c.signer.Identity(), c.origin, operationID, nonce, c.clock())
}
func (c *Client) Preview(ctx context.Context, invitationID, secret, operationID string) (InvitationPreview, error) {
	nonce, err := NewNonce()
	if err != nil {
		return InvitationPreview{}, err
	}
	request := map[string]any{"schemaVersion": 1, "invitationId": invitationID, "secret": secret, "participant": c.signer.Identity(), "operationId": operationID, "nonce": nonce}
	if !closed("PeerInvitationPreviewRequest", request) {
		return InvitationPreview{}, ErrProof
	}
	if err = c.identity(ctx, operationID); err != nil {
		return InvitationPreview{}, err
	}
	var preview InvitationPreview
	if err = c.post(ctx, "/api/peer/invitations/preview", "PeerInvitationPreviewRequest", request, "PeerInvitationPreview", &preview); err != nil {
		return InvitationPreview{}, err
	}
	if err = VerifyInvitationPreview(preview, c.host, c.signer.Identity(), c.origin, invitationID, operationID, nonce, c.clock()); err != nil {
		return InvitationPreview{}, err
	}
	return preview, nil
}

// ClaimPending is called only after the local Owner's approved intent is durable.
// A dropped response does not clear it or allocate another operation/Member.
func (c *Client) ClaimPending(ctx context.Context, journal *JoinJournal, operationID string) (JoinReceipt, error) {
	if journal == nil {
		return JoinReceipt{}, ErrStore
	}
	pending, err := journal.Load(operationID)
	if err != nil {
		return JoinReceipt{}, err
	}
	if pending.Participant != c.signer.Identity() || pending.LocalUserID != c.signer.LocalUserID() || pending.Invitation.HostOrigin != c.origin || !equalJSON(pending.Invitation.Host, c.host) {
		return JoinReceipt{}, ErrProof
	}
	if err = c.identity(ctx, operationID); err != nil {
		return JoinReceipt{}, err
	}
	invitationDigest, err := semanticDigest(pending.Invitation)
	if err != nil {
		return JoinReceipt{}, err
	}
	intent := map[string]any{"invitationId": pending.Invitation.InvitationID, "invitationDigest": invitationDigest, "operationId": operationID,
		"participant": pending.Participant, "localUserId": pending.LocalUserID, "displayName": pending.DisplayName}
	digest, err := semanticDigest(intent)
	if err != nil {
		return JoinReceipt{}, err
	}
	request := map[string]any{"schemaVersion": 1, "invitationId": pending.Invitation.InvitationID, "secret": pending.Secret,
		"participant": pending.Participant, "operationId": operationID, "subjectDigest": digest}
	var challenge wire.PeerChallenge
	if err = c.post(ctx, "/api/peer/invitations/challenge", "PeerClaimChallengeRequest", request, "PeerChallenge", &challenge); err != nil {
		return JoinReceipt{}, err
	}
	now := c.clock()
	expires, err := time.Parse(time.RFC3339Nano, challenge.ExpiresAt)
	if err != nil || challenge.HostNodeID != c.host.NodeID || challenge.ParticipantNodeID != c.signer.Identity().NodeID ||
		!expires.After(now) || expires.After(now.Add((wire.ProofLifetimeSeconds+wire.ProofClockSkewSeconds)*time.Second)) {
		return JoinReceipt{}, ErrProof
	}
	proof, err := c.signer.Sign(ProofContext{Purpose: "invitation.claim", AudienceNodeID: c.host.NodeID, OperationID: operationID, Nonce: challenge.Nonce, SubjectDigest: digest}, now)
	if err != nil {
		return JoinReceipt{}, err
	}
	intent["schemaVersion"] = 1
	intent["secret"] = pending.Secret
	intent["challengeId"] = challenge.ChallengeID
	intent["proof"] = proof
	var joined Joined
	if err = c.post(ctx, "/api/peer/invitations/claim", "PeerInvitationClaim", intent, "PeerJoined", &joined); err != nil {
		return JoinReceipt{}, err
	}
	if err = journal.RecordJoined(operationID, challenge.Nonce, joined, c.clock()); err != nil {
		return JoinReceipt{}, err
	}
	return joined.Runtime, nil
}
func (c *Client) HumanEntry(ctx context.Context, vault *HumanVault, membershipID string, scope wire.PeerScope, operationID string) (HumanEntry, error) {
	if vault == nil {
		return HumanEntry{}, ErrStore
	}
	human, err := vault.LoadForEntry(membershipID, c.clock())
	if err != nil {
		return HumanEntry{}, err
	}
	state, err := vault.runtime.Read()
	if err != nil {
		return HumanEntry{}, err
	}
	runtime, ok := findConnection(state, membershipID)
	if !ok || human.Participant != c.signer.Identity() || human.LocalUserID != c.signer.LocalUserID() || human.Host != c.host ||
		runtime.Receipt.Invitation.HostOrigin != c.origin || !scopeWithin(scope, wire.PeerScope(human.HumanCredential.Scope)) {
		return HumanEntry{}, ErrProof
	}
	if err = c.identity(ctx, operationID); err != nil {
		return HumanEntry{}, err
	}
	// Network waits cannot bypass a local withdrawal observed before sending the secret.
	current, err := vault.LoadForEntry(membershipID, c.clock())
	if err != nil || !equalJSON(current, human) {
		return HumanEntry{}, ErrStore
	}
	nonce, err := NewNonce()
	if err != nil {
		return HumanEntry{}, err
	}
	digest, err := semanticDigest(map[string]any{"bindingCredentialId": human.HumanCredential.CredentialID, "operationId": operationID, "scope": scope})
	if err != nil {
		return HumanEntry{}, err
	}
	proof, err := c.signer.Sign(ProofContext{Purpose: "human.entry", AudienceNodeID: c.host.NodeID, OperationID: operationID, Nonce: nonce, SubjectDigest: digest}, c.clock())
	if err != nil {
		return HumanEntry{}, err
	}
	request := map[string]any{"schemaVersion": 1, "operationId": operationID, "bindingCredentialId": human.HumanCredential.CredentialID,
		"bindingToken": human.HumanCredential.Token, "scope": scope, "nonce": nonce, "proof": proof}
	var entry HumanEntry
	if err = c.post(ctx, "/api/peer/human-entry", "PeerHumanEntryRequest", request, "PeerHumanEntry", &entry); err != nil {
		return HumanEntry{}, err
	}
	if err = VerifyHumanEntry(entry, human, runtime.Receipt, scope, operationID, nonce, c.clock()); err != nil {
		return HumanEntry{}, err
	}
	if _, err = vault.LoadForEntry(membershipID, c.clock()); err != nil {
		return HumanEntry{}, err
	}
	return entry, nil
}
func (c *Client) post(ctx context.Context, path, requestKind string, value any, responseKind string, result any) error {
	return c.postMachine(ctx, path, requestKind, value, responseKind, result, "")
}
func (c *Client) postMachine(ctx context.Context, path, requestKind string, value any, responseKind string, result any, token string) error {
	if err := c.checkLocal(); err != nil {
		return err
	}
	if !closed(requestKind, value) {
		return ErrProof
	}
	raw, err := json.Marshal(value)
	maximum := 16 * 1024
	if path == "/api/peer/agents/sync" && requestKind == "PeerAgentSyncRequest" && token != "" {
		maximum = wire.MaximumJSONBytes
	}
	if path == "/api/peer/runs/events" && requestKind == "PeerRunEventRequest" && token != "" {
		maximum = wire.MaximumJSONBytes
	}
	if path == "/api/peer/runs/poll" && requestKind == "PeerRunPollRequest" && token != "" {
		maximum = 64 * 1024
	}
	if err != nil || len(raw) > maximum {
		return ErrProof
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.origin+path, bytes.NewReader(raw))
	if err != nil {
		return ErrTransport
	}
	request.Header.Set("content-type", "application/json")
	if token != "" {
		request.Header.Set("authorization", "Bearer "+token)
	}
	response, err := c.http.Do(request)
	if err != nil {
		return ErrTransport
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, wire.MaximumJSONBytes+1))
	if guardErr := c.checkLocal(); guardErr != nil {
		return guardErr
	}
	if err != nil || len(body) > wire.MaximumJSONBytes {
		return ErrTransport
	}
	if response.StatusCode != http.StatusOK {
		var denied wire.PeerError
		if wire.Decode("PeerError", body, &denied) == nil {
			return &RemoteError{Code: string(denied.Code)}
		}
		return ErrTransport
	}
	if wire.Decode(responseKind, body, result) != nil {
		return ErrProof
	}
	return nil
}
