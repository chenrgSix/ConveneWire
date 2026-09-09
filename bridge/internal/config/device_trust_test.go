package config

import (
	"encoding/json"
	"testing"
)

func TestDeviceExecutionTrustRequiresExactPairingAndCannotComeFromAgentJSON(t *testing.T) {
	cfg := Config{ServerURL: "https://central.example", Agents: []AgentConfig{{Adapter: "codex"}, {Adapter: "generic"}, {Adapter: "codex", OwnerPrivateOutput: true}}}
	if cfg.FullTrustRevision(cfg.ServerURL, "device_owner01", "member_owner01") != 0 {
		t.Fatal("default granted trust")
	}
	cfg.DeviceExecutionTrust = &DeviceExecutionTrust{Mode: "full", Revision: 2, ServerURL: cfg.ServerURL, DeviceID: "device_owner01", OwnerMemberID: "member_owner01"}
	effective := cfg.WithDeviceExecutionTrust(cfg.ServerURL, "device_owner01", "member_owner01")
	if effective.Agents[0].TrustedExecutionRevision != 2 || effective.Agents[1].TrustedExecutionRevision != 0 || effective.Agents[2].TrustedExecutionRevision != 0 || cfg.Agents[0].TrustedExecutionRevision != 0 {
		t.Fatal("wrong effective scope")
	}
	for _, v := range [][3]string{{"https://other.example", "device_owner01", "member_owner01"}, {cfg.ServerURL, "device_other01", "member_owner01"}, {cfg.ServerURL, "device_owner01", "member_other01"}} {
		if cfg.FullTrustRevision(v[0], v[1], v[2]) != 0 {
			t.Fatal("consent crossed a pairing")
		}
	}
	var agent AgentConfig
	_ = json.Unmarshal([]byte(`{"trustedExecutionRevision":2}`), &agent)
	if agent.TrustedExecutionRevision != 0 {
		t.Fatal("Agent JSON granted device trust")
	}
	cfg.DeviceExecutionTrust.Mode = "restricted"
	if cfg.FullTrustRevision(cfg.ServerURL, "device_owner01", "member_owner01") != 0 {
		t.Fatal("revoked trust")
	}
}

func TestCentralApprovalConsentIsLocalAndSeparateFromFullTrust(t *testing.T) {
	cfg := Config{ServerURL: "https://central.example", Agents: []AgentConfig{{Adapter: "codex"}, {Adapter: "codex", OwnerPrivateOutput: true}, {Adapter: "generic"}}}
	cfg.DeviceExecutionTrust = &DeviceExecutionTrust{Mode: "central-approval", Revision: 3, ServerURL: cfg.ServerURL, DeviceID: "device_owner01", OwnerMemberID: "member_owner01"}
	effective := cfg.WithDeviceExecutionTrust(cfg.ServerURL, "device_owner01", "member_owner01")
	if effective.Agents[0].CentralApprovalRevision != 3 || effective.Agents[0].TrustedExecutionRevision != 0 || effective.Agents[1].CentralApprovalRevision != 0 || effective.Agents[2].CentralApprovalRevision != 0 {
		t.Fatal("incorrect approval scope")
	}
	if cfg.CentralApprovalRevision("https://other.example", "device_owner01", "member_owner01") != 0 || cfg.CentralApprovalRevision(cfg.ServerURL, "device_other01", "member_owner01") != 0 {
		t.Fatal("approval crossed pairing")
	}
	var agent AgentConfig
	_ = json.Unmarshal([]byte(`{"centralApprovalRevision":3}`), &agent)
	if agent.CentralApprovalRevision != 0 {
		t.Fatal("Agent JSON enabled approval")
	}
	cfg.DeviceExecutionTrust.Mode = "restricted"
	if cfg.CentralApprovalRevision(cfg.ServerURL, "device_owner01", "member_owner01") != 0 {
		t.Fatal("revocation failed")
	}
}
