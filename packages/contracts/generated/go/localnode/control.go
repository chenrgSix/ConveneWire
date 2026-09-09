// Code generated from JSON Schema; DO NOT EDIT.

package localnodecontracts

type LocalNodeIdentity struct {
	NodeID        string `json:"nodeId"`
	OwnerUserID   string `json:"ownerUserId"`
	Port          int64  `json:"port"`
	SchemaVersion int64  `json:"schemaVersion"`
	Secret        string `json:"secret"`
}

type LocalNodeLaunch struct {
	ControlToken  string   `json:"controlToken"`
	Identity      Identity `json:"identity"`
	SchemaVersion int64    `json:"schemaVersion"`
}

type Identity struct {
	NodeID        string `json:"nodeId"`
	OwnerUserID   string `json:"ownerUserId"`
	Port          int64  `json:"port"`
	SchemaVersion int64  `json:"schemaVersion"`
	Secret        string `json:"secret"`
}

type LocalNodeReady struct {
	LaunchProof   string `json:"launchProof"`
	NodeID        string `json:"nodeId"`
	Origin        string `json:"origin"`
	SchemaVersion int64  `json:"schemaVersion"`
}

type LocalNodeBinding struct {
	DeviceID      string `json:"deviceId"`
	OwnerMemberID string `json:"ownerMemberId"`
	ServerURL     string `json:"serverUrl"`
	TeamID        string `json:"teamId"`
	Token         string `json:"token"`
}
