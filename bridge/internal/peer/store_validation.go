package peer

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

// ValidateOrigin pins an exact canonical origin independently of TLS trust.
func ValidateOrigin(value string) error {
	u, err := url.Parse(value)
	if err != nil || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Opaque != "" || u.Host == "" || u.String() != value || strings.ToLower(u.Host) != u.Host {
		return ErrStore
	}
	if port := u.Port(); port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 || strconv.Itoa(n) != port {
			return ErrStore
		}
	}
	if (u.Scheme == "https" && u.Port() == "443") || (u.Scheme == "http" && u.Port() == "80") {
		return ErrStore
	}
	if u.Scheme == "https" {
		return nil
	}
	host := u.Hostname()
	ip := net.ParseIP(host)
	if u.Scheme == "http" && (host == "localhost" || (ip != nil && ip.IsLoopback())) {
		return nil
	}
	return ErrStore
}

func JoinReceiptDigest(receipt JoinReceipt) (string, error) {
	invitation, err := json.Marshal(receipt.Invitation)
	if err != nil {
		return "", err
	}
	invitationDigest, err := wire.Digest(invitation)
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(map[string]any{"invitationDigest": invitationDigest, "membership": receipt.Membership, "machineCredential": receipt.MachineCredential})
	if err != nil {
		return "", err
	}
	return wire.Digest(raw)
}

func validateState(state State, participant wire.PeerNodeIdentity, localUserID string) error {
	if state.Participant != participant || state.LocalUserID != localUserID {
		return ErrStore
	}
	peers := map[string]bool{}
	activePins := map[string]string{}
	operations := map[string]bool{}
	for _, connection := range state.Connections {
		receipt := connection.Receipt
		m := receipt.Membership
		p := receipt.Proof.Payload
		if peers[m.PeerID] || m.ParticipantNodeID != participant.NodeID || m.LocalUserID != localUserID || m.HostNodeID == participant.NodeID ||
			m.HostNodeID != receipt.Invitation.Host.NodeID || m.State != "active" || m.Revision != 1 ||
			m.ExpiresAt != receipt.Invitation.MembershipExpiresAt || m.CreatedAt > receipt.Invitation.ExpiresAt || m.CreatedAt >= m.ExpiresAt ||
			!equalJSON(m.Scope, receipt.Invitation.Scope) || receipt.MachineCredential.PeerID != m.PeerID ||
			receipt.MachineCredential.ExpiresAt > m.ExpiresAt || receipt.MachineCredential.ExpiresAt <= m.CreatedAt || ValidateOrigin(receipt.Invitation.HostOrigin) != nil {
			return ErrStore
		}
		peers[m.PeerID] = true
		if connection.State == "active" {
			pin := receipt.Invitation.Host.PublicKey + "|" + receipt.Invitation.HostOrigin
			if prior := activePins[m.HostNodeID]; prior != "" && prior != pin {
				return ErrStore
			}
			activePins[m.HostNodeID] = pin
		}
		digest, err := JoinReceiptDigest(receipt)
		if err != nil || p.SubjectDigest != digest || p.Purpose != "invitation.claim" ||
			p.SignerNodeID != m.HostNodeID || p.SignerPublicKey != receipt.Invitation.Host.PublicKey || p.AudienceNodeID != participant.NodeID {
			return ErrStore
		}
		issued, err := time.Parse(time.RFC3339Nano, p.IssuedAt)
		if err != nil || !wire.ProofTimeValid(wire.PeerProofPayload(p), issued) {
			return ErrStore
		}
		transcript, err := wire.ProofTranscript(wire.PeerProofPayload(p))
		if err != nil {
			return ErrStore
		}
		key, err := base64.RawURLEncoding.DecodeString(p.SignerPublicKey)
		if err != nil {
			return ErrStore
		}
		signature, err := base64.RawURLEncoding.DecodeString(receipt.Proof.Signature)
		if err != nil || !ed25519.Verify(key, transcript, signature) {
			return ErrStore
		}
		if validateHistory(connection) != nil || validateLocalExports(connection, operations) != nil {
			return ErrStore
		}
	}
	return nil
}

func validateHistory(connection LocalConnection) error {
	m := connection.Receipt.Membership
	grants := map[string]wire.AgentExportGrant{}
	grantVersions := map[string]wire.AgentExportGrant{}
	exportHeads := map[string]string{}
	for _, g := range connection.Exports {
		previous, seen := grants[g.ExportID]
		if g.PeerID != m.PeerID || g.AuthorityNodeID != m.HostNodeID || g.ParticipantNodeID != m.ParticipantNodeID || g.TeamID != m.Scope.TeamID ||
			g.Revision != previous.Revision+1 || (seen && (previous.LocalAgentID != g.LocalAgentID || previous.State == "revoked" || g.IssuedAt < previous.IssuedAt)) ||
			(!seen && g.State != "active") {
			return ErrStore
		}
		if seen && exportHeads[g.LocalAgentID] != g.ExportID && g.State == "active" {
			return ErrStore
		}
		if !seen {
			exportHeads[g.LocalAgentID] = g.ExportID
		}
		if g.State == "active" && (g.ExpiresAt > m.ExpiresAt || g.ExpiresAt <= g.IssuedAt || !roomsWithinMembership(g.RoomIDS, m)) {
			return ErrStore
		}
		grants[g.ExportID] = g
		grantVersions[g.ExportID+"/"+strconv.FormatInt(g.Revision, 10)] = g
	}
	acceptances := map[string]wire.RemoteAgentAcceptance{}
	acceptanceHeads := map[string]string{}
	for _, a := range connection.Acceptances {
		previous, seen := acceptances[a.AcceptanceID]
		grant, found := grantVersions[a.ExportID+"/"+strconv.FormatInt(a.GrantRevision, 10)]
		raw, _ := json.Marshal(grant)
		digest, err := wire.Digest(raw)
		if !found || err != nil || a.GrantDigest != digest || a.PeerID != m.PeerID || a.AuthorityNodeID != m.HostNodeID || a.ParticipantNodeID != m.ParticipantNodeID || a.TeamID != m.Scope.TeamID || a.MemberID != m.MemberID ||
			a.Revision != previous.Revision+1 || (seen && (previous.ExportID != a.ExportID || previous.State == "revoked" || a.IssuedAt < previous.IssuedAt)) || (!seen && a.State != "active") {
			return ErrStore
		}
		if seen && acceptanceHeads[grant.LocalAgentID] != a.AcceptanceID && a.State == "active" {
			return ErrStore
		}
		if !seen {
			acceptanceHeads[grant.LocalAgentID] = a.AcceptanceID
		}
		if a.State == "active" && (grant.State != "active" || a.ExpiresAt > grant.ExpiresAt || a.ExpiresAt <= a.IssuedAt || !subset(a.RoomIDS, grant.RoomIDS) || !capabilitySubset(a.Capabilities, grant.Capabilities)) {
			return ErrStore
		}
		acceptances[a.AcceptanceID] = a
	}
	return nil
}

func roomsWithinMembership(rooms []string, m wire.PeerMembership) bool {
	if m.Scope.Kind == "team" {
		return true
	}
	return m.Scope.RoomID != nil && len(rooms) == 1 && rooms[0] == *m.Scope.RoomID
}
func subset(a, b []string) bool {
	for _, value := range a {
		found := false
		for _, allowed := range b {
			if value == allowed {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
func capabilitySubset(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	var requested, allowed map[string]bool
	if json.Unmarshal(x, &requested) != nil || json.Unmarshal(y, &allowed) != nil {
		return false
	}
	for key, value := range requested {
		if value && !allowed[key] {
			return false
		}
	}
	return true
}
