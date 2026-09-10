package console

import (
	"net/http"
	"time"

	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/peer"
)

type nativePeerExports interface {
	PeerExports(config.Config) (*peer.Exporter, *peer.Sources, error)
	PeerWithdrawal() (*peer.Exporter, error)
	PeerAuthorizationChanged(string)
}

func (s *Service) peerExportsLocked() (nativePeerExports, *peer.Exporter, *peer.Sources, error) {
	owner, ok := s.options.NativePeers.(nativePeerExports)
	if !ok || s.closed || s.owner == nil || s.configuration == nil || s.configuration.LocalNodeID == "" || s.bridgeRestartPending {
		return nil, nil, nil, peer.ErrExport
	}
	exporter, sources, err := owner.PeerExports(cloneConfiguration(*s.configuration))
	return owner, exporter, sources, err
}

func (s *Service) getPeerExports(response http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, exporter, sources, err := s.peerExportsLocked()
	configurationAvailable := err == nil
	if err != nil {
		owner, ok := s.options.NativePeers.(nativePeerExports)
		if !ok || s.closed || s.owner == nil {
			writeError(response, http.StatusConflict, "本机分享记录暂不可用，请刷新")
			return
		}
		exporter, err = owner.PeerWithdrawal()
		if err != nil {
			writeError(response, http.StatusConflict, "本机分享记录暂不可用，请保留原始数据")
			return
		}
	}
	state, err := exporter.OwnerState(time.Now())
	if err != nil {
		writeError(response, http.StatusConflict, "Peer 记录不可用，请保留原始数据")
		return
	}
	reviews := []peer.SourceReview{}
	if configurationAvailable {
		reviews = sources.Reviews()
	}
	writeJSON(response, http.StatusOK, map[string]any{"state": state, "sources": reviews, "configurationAvailable": configurationAvailable})
}

// Space membership is readable even while Runtime configuration is unavailable
// or being replaced. It exposes no Export availability or credential material.
func (s *Service) getPeerSpaces(response http.ResponseWriter, _ *http.Request) {
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
	state, err := exporter.OwnerState(time.Now())
	if err != nil {
		peerOwnerError(response, err)
		return
	}
	connections := make([]map[string]any, 0, len(state.Connections))
	for _, connection := range state.Connections {
		connections = append(connections, map[string]any{"invitation": connection.Invitation,
			"membership": connection.Membership, "state": connection.State})
	}
	writeJSON(response, http.StatusOK, map[string]any{"participant": state.Participant, "localUserId": state.LocalUserID, "connections": connections})
}

func (s *Service) preparePeerExport(response http.ResponseWriter, request *http.Request) {
	var input struct {
		ExpectedRevision    int64              `json:"expectedRevision"`
		ConfigurationDigest string             `json:"configurationDigest"`
		Request             peer.ExportRequest `json:"request"`
	}
	if decodePeerJSON(request, &input) != nil {
		writeError(response, http.StatusBadRequest, "请提交完整的本机 Agent 分享选择")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	owner, exporter, _, err := s.peerExportsLocked()
	if err != nil {
		writeError(response, http.StatusConflict, "本机配置正在变化，请刷新")
		return
	}
	entry, err := exporter.PrepareReviewed(input.ExpectedRevision, input.ConfigurationDigest, input.Request, time.Now())
	if err != nil {
		writeError(response, http.StatusConflict, "配置或授权范围已变化，请重新审阅后分享")
		return
	}
	owner.PeerAuthorizationChanged(entry.Offer.Grant.PeerID)
	writeJSON(response, http.StatusCreated, entry)
}

func (s *Service) withdrawPeerExport(response http.ResponseWriter, request *http.Request) {
	var input struct {
		ExpectedRevision int64  `json:"expectedRevision"`
		MembershipID     string `json:"membershipId"`
		ExportID         string `json:"exportId"`
		GrantRevision    int64  `json:"grantRevision"`
		OperationID      string `json:"operationId"`
	}
	if decodePeerJSON(request, &input) != nil {
		writeError(response, http.StatusBadRequest, "请指定需要撤回的分享及版本")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	owner, ok := s.options.NativePeers.(nativePeerExports)
	if !ok || s.closed || s.owner == nil {
		writeError(response, http.StatusConflict, "本机分享记录暂不可用，请刷新")
		return
	}
	exporter, err := owner.PeerWithdrawal()
	if err != nil {
		writeError(response, http.StatusConflict, "本机分享记录暂不可用，请保留原始数据")
		return
	}
	entry, err := exporter.Withdraw(input.ExpectedRevision, input.MembershipID, input.ExportID, input.GrantRevision, input.OperationID, time.Now())
	if err != nil {
		writeError(response, http.StatusConflict, "分享版本已变化，请刷新后撤回")
		return
	}
	owner.PeerAuthorizationChanged(entry.Offer.Grant.PeerID)
	writeJSON(response, http.StatusOK, entry)
}
