package config

import "fmt"

// DeviceExecutionTrust is local owner consent, bound to one pairing.
type DeviceExecutionTrust struct {
	Mode          string `json:"mode"`
	Revision      int64  `json:"revision"`
	ServerURL     string `json:"serverUrl"`
	DeviceID      string `json:"deviceId"`
	OwnerMemberID string `json:"ownerMemberId"`
}

func (t *DeviceExecutionTrust) Validate() error {
	if t == nil {
		return nil
	}
	if (t.Mode != "full" && t.Mode != "restricted") || t.Revision < 1 || t.Revision > 9007199254740991 ||
		t.ServerURL == "" || t.DeviceID == "" || t.OwnerMemberID == "" {
		return fmt.Errorf("deviceExecutionTrust must contain an exact local pairing and revision")
	}
	return nil
}

func (c Config) FullTrustRevision(serverURL, deviceID, ownerMemberID string) int64 {
	t := c.DeviceExecutionTrust
	if t == nil || t.Validate() != nil || t.Mode != "full" || c.ServerURL != serverURL ||
		t.ServerURL != serverURL || t.DeviceID != deviceID || t.OwnerMemberID != ownerMemberID {
		return 0
	}
	return t.Revision
}

func (c Config) WithDeviceExecutionTrust(serverURL, deviceID, ownerMemberID string) Config {
	revision := c.FullTrustRevision(serverURL, deviceID, ownerMemberID)
	c.Agents = append([]AgentConfig(nil), c.Agents...)
	for i := range c.Agents {
		c.Agents[i].TrustedExecutionRevision = 0
		if c.Agents[i].Adapter == "codex" && !c.Agents[i].OwnerPrivateOutput {
			c.Agents[i].TrustedExecutionRevision = revision
		}
	}
	return c
}
