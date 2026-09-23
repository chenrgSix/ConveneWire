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

type LocalNodeControlState struct {
	Binding          *Binding     `json:"binding"`
	ConsolePage      *ConsolePage `json:"consolePage,omitempty"`
	ConsoleRequestID string       `json:"consoleRequestId"`
	HandoffTaskID    *string      `json:"handoffTaskId,omitempty"`
}

type Binding struct {
	DeviceID      string `json:"deviceId"`
	OwnerMemberID string `json:"ownerMemberId"`
	ServerURL     string `json:"serverUrl"`
	TeamID        string `json:"teamId"`
	Token         string `json:"token"`
}

type DesktopHandoffRequest struct {
	Action         Action  `json:"action"`
	AdoptionID     *string `json:"adoptionId,omitempty"`
	AudienceDigest *string `json:"audienceDigest,omitempty"`
	RunID          *string `json:"runId,omitempty"`
	TaskID         string  `json:"taskId"`
}

type DesktopHandoffScope struct {
	AdoptionID     string   `json:"adoptionId"`
	AgentID        string   `json:"agentId"`
	AgentName      string   `json:"agentName"`
	Audience       []string `json:"audience"`
	AudienceDigest string   `json:"audienceDigest"`
	DeviceID       string   `json:"deviceId"`
	NodeID         string   `json:"nodeId"`
	OwnerMemberID  string   `json:"ownerMemberId"`
	RoomID         string   `json:"roomId"`
	RoomName       string   `json:"roomName"`
	State          State    `json:"state"`
	TaskID         string   `json:"taskId"`
	TaskTitle      string   `json:"taskTitle"`
	TeamID         string   `json:"teamId"`
}

type ConsolePage string

const (
	Agents  ConsolePage = "agents"
	Handoff ConsolePage = "handoff"
	Peers   ConsolePage = "peers"
)

type Action string

const (
	Confirm  Action = "confirm"
	Release  Action = "release"
	Scope    Action = "scope"
	Validate Action = "validate"
)

type State string

const (
	Attached  State = "attached"
	Available State = "available"
	Paused    State = "paused"
	Released  State = "released"
)
