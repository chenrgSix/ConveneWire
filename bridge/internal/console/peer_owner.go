package console

import (
	"net/http"

	"convenewire.dev/bridge/internal/peer"
	wire "convenewire.dev/contracts/generated/go/peer"
)

type nativePeerOwner interface {
	PeerOwnerAccess() (peer.OwnerOperations, error)
	PeerAuthorizationChanged(string)
}

// Accessor construction only reads private local state. Release the Console
// mutex before network waits so other owner controls and Device work continue.
func (s *Service) peerOwner() (nativePeerOwner, peer.OwnerOperations, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	owner, ok := s.options.NativePeers.(nativePeerOwner)
	if !ok || s.closed || s.owner == nil {
		return nil, nil, peer.ErrStore
	}
	access, err := owner.PeerOwnerAccess()
	return owner, access, err
}

func peerOwnerError(response http.ResponseWriter, err error) {
	code := "PEER_OWNER_OPERATION_UNCONFIRMED"
	if err == peer.ErrTLSConfiguration {
		code = "PEER_TLS_CONFIGURATION_UNAVAILABLE"
	}
	writeJSON(response, http.StatusConflict, map[string]string{"error": "操作尚未确认，请保留原操作并检查连接或本机状态", "code": code})
}

func (s *Service) previewPeerInvitation(response http.ResponseWriter, request *http.Request) {
	var input peer.InvitationInput
	if decodePeerJSON(request, &input) != nil {
		writeError(response, http.StatusBadRequest, "请提交完整的 Peer 邀请")
		return
	}
	_, access, err := s.peerOwner()
	if err != nil {
		peerOwnerError(response, err)
		return
	}
	review, err := access.Preview(request.Context(), input)
	if err != nil {
		peerOwnerError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, review)
}

func (s *Service) confirmPeerInvitation(response http.ResponseWriter, request *http.Request) {
	var input peer.JoinConfirmation
	if decodePeerJSON(request, &input) != nil {
		writeError(response, http.StatusBadRequest, "请确认已审阅的邀请范围")
		return
	}
	owner, access, err := s.peerOwner()
	if err != nil {
		peerOwnerError(response, err)
		return
	}
	outcome, err := access.Confirm(request.Context(), input)
	if err != nil {
		peerOwnerError(response, err)
		return
	}
	owner.PeerAuthorizationChanged(outcome.Membership.PeerID)
	writeJSON(response, http.StatusOK, outcome)
}

func (s *Service) getPeerJoins(response http.ResponseWriter, _ *http.Request) {
	_, access, err := s.peerOwner()
	if err != nil {
		peerOwnerError(response, err)
		return
	}
	pending, err := access.Pending()
	if err != nil {
		peerOwnerError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"pending": pending})
}

func (s *Service) recoverPeerJoin(response http.ResponseWriter, request *http.Request) {
	var input struct{}
	if decodePeerJSON(request, &input) != nil {
		writeError(response, http.StatusBadRequest, "恢复操作不接受新的身份或邀请范围")
		return
	}
	owner, access, err := s.peerOwner()
	if err != nil {
		peerOwnerError(response, err)
		return
	}
	outcome, err := access.Recover(request.Context(), request.PathValue("operationId"))
	if err != nil {
		peerOwnerError(response, err)
		return
	}
	owner.PeerAuthorizationChanged(outcome.Membership.PeerID)
	writeJSON(response, http.StatusOK, outcome)
}

func (s *Service) preparePeerHumanEntry(response http.ResponseWriter, request *http.Request) {
	var input struct {
		MembershipID string         `json:"membershipId"`
		Scope        wire.PeerScope `json:"scope"`
		OperationID  string         `json:"operationId"`
	}
	if decodePeerJSON(request, &input) != nil {
		writeError(response, http.StatusBadRequest, "请指定需要进入的 Peer 空间")
		return
	}
	_, access, err := s.peerOwner()
	if err != nil {
		peerOwnerError(response, err)
		return
	}
	entry, err := access.HumanEntry(request.Context(), input.MembershipID, input.Scope, input.OperationID)
	if err != nil {
		peerOwnerError(response, err)
		return
	}
	// A short, one-use browser entry is intended for this local Owner. Never
	// include the long-lived human binding or machine credential in the response.
	writeJSON(response, http.StatusOK, map[string]any{"hostOrigin": entry.HostOrigin, "credentialId": entry.Credential.CredentialID,
		"token": entry.Credential.Token, "exchangeExpiresAt": entry.ExchangeExpiresAt, "scope": entry.Credential.Scope})
}
