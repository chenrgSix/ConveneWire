package console

import (
	"net/http"

	"convenewire.dev/bridge/internal/config"
)

type DeviceTrustView struct {
	Mode     string `json:"mode"`
	Revision int64  `json:"revision"`
	Central  string `json:"central"`
	Editable bool   `json:"editable"`
}

func (s *Service) deviceTrustViewLocked() DeviceTrustView {
	view := DeviceTrustView{Mode: "restricted"}
	if s.configuration == nil {
		return view
	}
	view.Central = s.configuration.ServerURL
	if t := s.configuration.DeviceExecutionTrust; t != nil {
		view.Revision = t.Revision
	}
	if s.credential == nil {
		return view
	}
	if s.configuration.FullTrustRevision(s.credential.ServerURL, s.credential.DeviceID, s.credential.OwnerMemberID) > 0 {
		view.Mode = "full"
	}
	view.Editable = !s.closed && !s.governedMutation && s.joinCancel == nil && !s.runtimePreflight && len(s.runtimeTests) == 0
	return view
}

func (s *Service) updateDeviceExecutionTrust(response http.ResponseWriter, request *http.Request) {
	var input struct {
		Mode             string `json:"mode"`
		ExpectedRevision int64  `json:"expectedRevision"`
		Confirm          bool   `json:"confirm"`
	}
	if decodeJSON(request, &input) != nil || !input.Confirm || (input.Mode != "full" && input.Mode != "restricted") || input.ExpectedRevision < 0 || input.ExpectedRevision >= 9007199254740991 {
		writeError(response, http.StatusBadRequest, "Confirm the exact device trust choice")
		return
	}
	s.mu.Lock()
	view := s.deviceTrustViewLocked()
	if !view.Editable || s.owner == nil {
		s.mu.Unlock()
		writeError(response, http.StatusConflict, "Device trust cannot be changed now")
		return
	}
	if view.Revision == input.ExpectedRevision+1 && view.Mode == input.Mode {
		s.mu.Unlock()
		writeJSON(response, http.StatusOK, s.State())
		return
	}
	if view.Revision != input.ExpectedRevision {
		s.mu.Unlock()
		writeError(response, http.StatusConflict, "Device trust changed; refresh before choosing again")
		return
	}
	s.governedMutation = true
	wasRunning := s.bridgeCancel != nil || s.state.BridgeRunning
	s.mu.Unlock()
	// StopBridge waits for the full worker/process boundary before persistence.
	if wasRunning {
		s.StopBridge()
	}
	s.mu.Lock()
	if s.closed || s.owner == nil || s.configuration == nil || s.credential == nil {
		s.governedMutation = false
		s.mu.Unlock()
		writeError(response, http.StatusConflict, "Device trust owner closed before the change could be saved")
		return
	}
	candidate := cloneConfiguration(*s.configuration)
	candidate.DeviceExecutionTrust = &config.DeviceExecutionTrust{Mode: input.Mode, Revision: input.ExpectedRevision + 1,
		ServerURL: s.credential.ServerURL, DeviceID: s.credential.DeviceID, OwnerMemberID: s.credential.OwnerMemberID}
	err := candidate.Validate()
	if err == nil {
		err = s.replaceConfigurationLocked(candidate)
	}
	s.governedMutation = false
	s.mu.Unlock()
	// A saved revocation remains saved even if reconnection fails.
	if wasRunning && (err == nil || input.Mode != "restricted") {
		_, _ = s.StartBridge()
	}
	if err != nil {
		writeError(response, http.StatusConflict, publicError(err))
		return
	}
	writeJSON(response, http.StatusOK, s.State())
}
