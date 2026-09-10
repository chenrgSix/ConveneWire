package console

import (
	"net/http"

	"convenewire.dev/bridge/internal/peer"
)

type nativePeerDepartures interface {
	PeerDepartures() (peer.DepartureOperations, error)
	PeerAuthorizationChanged(string)
}

func (s *Service) peerDepartures() (nativePeerDepartures, peer.DepartureOperations, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	owner, ok := s.options.NativePeers.(nativePeerDepartures)
	if !ok || s.closed || s.owner == nil {
		return nil, nil, peer.ErrStore
	}
	departures, err := owner.PeerDepartures()
	return owner, departures, err
}

func (s *Service) getPeerDepartures(response http.ResponseWriter, _ *http.Request) {
	_, departures, err := s.peerDepartures()
	if err != nil {
		peerOwnerError(response, err)
		return
	}
	views, err := departures.List()
	if err != nil {
		peerOwnerError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"departures": views})
}

func (s *Service) preparePeerDeparture(response http.ResponseWriter, request *http.Request) {
	var input struct {
		MembershipID string `json:"membershipId"`
		OperationID  string `json:"operationId"`
	}
	if decodePeerJSON(request, &input) != nil {
		writeError(response, http.StatusBadRequest, "请指定需要离开的成员关系")
		return
	}
	owner, departures, err := s.peerDepartures()
	if err != nil {
		peerOwnerError(response, err)
		return
	}
	view, err := departures.Prepare(request.Context(), input.MembershipID, input.OperationID)
	if err != nil {
		peerOwnerError(response, err)
		return
	}
	// Persist and invalidate the current local connector before any Host wait.
	owner.PeerAuthorizationChanged(view.Intent.PeerID)
	confirmed, err := departures.Synchronize(request.Context(), input.MembershipID)
	if err != nil {
		writeJSON(response, http.StatusAccepted, map[string]any{"departure": view, "code": "PEER_DEPARTURE_PENDING"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"departure": confirmed})
}

func (s *Service) recoverPeerDeparture(response http.ResponseWriter, request *http.Request) {
	var input struct{}
	if decodePeerJSON(request, &input) != nil {
		writeError(response, http.StatusBadRequest, "恢复离开操作不接受新的身份或范围")
		return
	}
	_, departures, err := s.peerDepartures()
	if err != nil {
		peerOwnerError(response, err)
		return
	}
	view, err := departures.Synchronize(request.Context(), request.PathValue("membershipId"))
	if err != nil {
		peerOwnerError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"departure": view})
}
