package console

import (
	"net/http"
	"time"

	"convenewire.dev/bridge/internal/peer"
)

func (s *Service) setPeerExecutionTrust(response http.ResponseWriter, request *http.Request) {
	var input struct {
		MembershipID     string `json:"membershipId"`
		ExpectedRevision *int64 `json:"expectedRevision"`
		Enabled          *bool  `json:"enabled"`
	}
	if decodePeerJSON(request, &input) != nil || input.MembershipID == "" || input.ExpectedRevision == nil || input.Enabled == nil {
		writeError(response, http.StatusBadRequest, "请指定空间、权限模式及当前版本")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	owner, ok := s.options.NativePeers.(nativePeerExports)
	if !ok || s.closed || s.owner == nil {
		peerOwnerError(response, peer.ErrStore)
		return
	}
	exporter, err := owner.PeerWithdrawal()
	if err != nil {
		peerOwnerError(response, err)
		return
	}
	peerID, trust, err := exporter.SetExecutionTrust(input.MembershipID, *input.ExpectedRevision, *input.Enabled, time.Now())
	if err != nil {
		writeError(response, http.StatusConflict, "空间或权限模式已变化，请刷新后重试")
		return
	}
	owner.PeerAuthorizationChanged(peerID)
	writeJSON(response, http.StatusOK, trust)
}
