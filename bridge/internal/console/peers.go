package console

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"

	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/peer"
	wire "convenewire.dev/contracts/generated/go/peer"
)

// Only the native shell supplies this capability. A paired Device credential
// or a network request cannot construct a Peer owner or approve its processes.
type NativePeers interface {
	PeerStatus() peer.ConnectorSnapshot
	PeerApprovals() ([]peer.ApprovalView, error)
	DecidePeerApproval(peer.ApprovalDecision) error
}

type nativeUnpairedCore interface {
	ValidateUnpairedConfiguration(config.Config) error
	RunUnpaired(context.Context, config.Config) error
}

func (s *Service) unpairedCoreLocked() nativeUnpairedCore {
	if s.configuration == nil || s.configuration.LocalNodeID == "" || s.credential != nil {
		return nil
	}
	core, _ := s.options.NativePeers.(nativeUnpairedCore)
	return core
}

func (s *Service) authorizePeer(next http.HandlerFunc) http.HandlerFunc {
	return s.authorize(func(response http.ResponseWriter, request *http.Request) {
		s.mu.Lock()
		available := s.options.NativePeers != nil && !s.closed
		s.mu.Unlock()
		if !available {
			writeError(response, http.StatusConflict, "Peer 操作需要正在运行的本地 Node")
			return
		}
		host, _, err := net.SplitHostPort(request.Host)
		ip := net.ParseIP(strings.Trim(host, "[]"))
		origin := request.Header.Get("origin")
		if err != nil || ip == nil || !ip.IsLoopback() || request.URL.RawQuery != "" ||
			(origin != "" && origin != "http://"+request.Host) || request.Header.Get("sec-fetch-site") == "cross-site" ||
			request.Header.Get("forwarded") != "" || request.Header.Get("x-forwarded-host") != "" {
			writeError(response, http.StatusForbidden, "Peer 操作只接受本机 Console 请求")
			return
		}
		next(response, request)
	})
}

func (s *Service) getPeerStatus(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, s.options.NativePeers.PeerStatus())
}

func (s *Service) getPeerApprovals(response http.ResponseWriter, _ *http.Request) {
	views, err := s.options.NativePeers.PeerApprovals()
	if err != nil {
		writeError(response, http.StatusConflict, "本机审批状态已变化，请刷新")
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"approvals": views})
}

// Local JSON also rejects duplicate keys and unknown fields. In particular an
// absent decision must never silently become a denial that consumes a request.
func decodePeerJSON(request *http.Request, value any) error {
	raw, err := io.ReadAll(io.LimitReader(request.Body, 16*1024+1))
	if err != nil || len(raw) > 16*1024 {
		return peer.ErrProof
	}
	if _, err := wire.CanonicalJSON(raw); err != nil {
		return err
	}
	if trimmed := bytes.TrimSpace(raw); len(trimmed) == 0 || trimmed[0] != '{' {
		return peer.ErrProof
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	return decoder.Decode(value)
}

func (s *Service) decidePeerApproval(response http.ResponseWriter, request *http.Request) {
	var input struct {
		ProcessID       string `json:"processId"`
		BindingDigest   string `json:"bindingDigest"`
		ConsentRevision int64  `json:"consentRevision"`
		Allow           *bool  `json:"allow"`
	}
	if decodePeerJSON(request, &input) != nil || input.Allow == nil {
		writeError(response, http.StatusBadRequest, "请提交当前审批的完整选择")
		return
	}
	decision := peer.ApprovalDecision{RequestID: request.PathValue("requestId"), ProcessID: input.ProcessID,
		BindingDigest: input.BindingDigest, ConsentRevision: input.ConsentRevision, Allow: *input.Allow}
	if s.options.NativePeers.DecidePeerApproval(decision) != nil {
		writeError(response, http.StatusConflict, "审批已结束或执行范围已变化，请刷新")
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{"status": "recorded"})
}
