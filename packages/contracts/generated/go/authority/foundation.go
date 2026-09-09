// Code generated from JSON Schema; DO NOT EDIT.

package authoritycontracts

type AuthorityRef struct {
	AuthorityNodeID string     `json:"authorityNodeId"`
	ObjectID        string     `json:"objectId"`
	ObjectType      ObjectType `json:"objectType"`
}

type AuthorityPin struct {
	AuthorityNodeID string `json:"authorityNodeId"`
	PublicKey       string `json:"publicKey"`
	ServerOrigin    string `json:"serverOrigin"`
}

type AuthorityProofRequest struct {
	Nonce string `json:"nonce"`
}

type AuthorityProofPayload struct {
	AuthorityNodeID string `json:"authorityNodeId"`
	BrowserOrigin   string `json:"browserOrigin"`
	DeviceID        string `json:"deviceId"`
	ExpiresAt       string `json:"expiresAt"`
	IssuedAt        string `json:"issuedAt"`
	Nonce           string `json:"nonce"`
	OwnerMemberID   string `json:"ownerMemberId"`
	PublicKey       string `json:"publicKey"`
	Signature       string `json:"signature"`
	TeamID          string `json:"teamId"`
}

type AuthorityProof struct {
	MessageID       string          `json:"messageId"`
	Payload         Payload         `json:"payload"`
	ProtocolVersion ProtocolVersion `json:"protocolVersion"`
	Timestamp       string          `json:"timestamp"`
	Type            Type            `json:"type"`
}

type Payload struct {
	AuthorityNodeID string `json:"authorityNodeId"`
	BrowserOrigin   string `json:"browserOrigin"`
	DeviceID        string `json:"deviceId"`
	ExpiresAt       string `json:"expiresAt"`
	IssuedAt        string `json:"issuedAt"`
	Nonce           string `json:"nonce"`
	OwnerMemberID   string `json:"ownerMemberId"`
	PublicKey       string `json:"publicKey"`
	Signature       string `json:"signature"`
	TeamID          string `json:"teamId"`
}

type AuthorityAgentMapping struct {
	LocalAgentID      string `json:"localAgentId"`
	Name              string `json:"name"`
	ProjectionAgentID string `json:"projectionAgentId"`
}

type AuthorityConnector struct {
	CredentialDir string                         `json:"credentialDir"`
	DeviceID      string                         `json:"deviceId"`
	Label         string                         `json:"label"`
	Mode          Mode                           `json:"mode"`
	OwnerMemberID string                         `json:"ownerMemberId"`
	Pin           AuthorityConnectorPin          `json:"pin"`
	Projections   []AuthorityConnectorProjection `json:"projections"`
	TeamID        string                         `json:"teamId"`
}

type AuthorityConnectorPin struct {
	AuthorityNodeID string `json:"authorityNodeId"`
	PublicKey       string `json:"publicKey"`
	ServerOrigin    string `json:"serverOrigin"`
}

type AuthorityConnectorProjection struct {
	LocalAgentID      string `json:"localAgentId"`
	Name              string `json:"name"`
	ProjectionAgentID string `json:"projectionAgentId"`
}

type AuthorityConnectionsConfig struct {
	Connectors    []Connector `json:"connectors"`
	Primary       Primary     `json:"primary"`
	SchemaVersion int64       `json:"schemaVersion"`
}

type Connector struct {
	CredentialDir string                `json:"credentialDir"`
	DeviceID      string                `json:"deviceId"`
	Label         string                `json:"label"`
	Mode          Mode                  `json:"mode"`
	OwnerMemberID string                `json:"ownerMemberId"`
	Pin           ConnectorPin          `json:"pin"`
	Projections   []ConnectorProjection `json:"projections"`
	TeamID        string                `json:"teamId"`
}

type ConnectorPin struct {
	AuthorityNodeID string `json:"authorityNodeId"`
	PublicKey       string `json:"publicKey"`
	ServerOrigin    string `json:"serverOrigin"`
}

type ConnectorProjection struct {
	LocalAgentID      string `json:"localAgentId"`
	Name              string `json:"name"`
	ProjectionAgentID string `json:"projectionAgentId"`
}

type Primary struct {
	AuthorityNodeID string `json:"authorityNodeId"`
	PublicKey       string `json:"publicKey"`
	ServerOrigin    string `json:"serverOrigin"`
}

type AuthoritySpace struct {
	AuthorityNodeID string `json:"authorityNodeId"`
	BrowserOrigin   string `json:"browserOrigin"`
	Kind            Kind   `json:"kind"`
	Label           string `json:"label"`
	TeamID          string `json:"teamId"`
}

type AuthoritySpaceDirectory struct {
	SchemaVersion int64   `json:"schemaVersion"`
	Spaces        []Space `json:"spaces"`
}

type Space struct {
	AuthorityNodeID string `json:"authorityNodeId"`
	BrowserOrigin   string `json:"browserOrigin"`
	Kind            Kind   `json:"kind"`
	Label           string `json:"label"`
	TeamID          string `json:"teamId"`
}

type ObjectType string

const (
	Discussion ObjectType = "discussion"
	Message    ObjectType = "message"
	Result     ObjectType = "result"
	Room       ObjectType = "room"
	Run        ObjectType = "run"
	Task       ObjectType = "task"
	Team       ObjectType = "team"
	Turn       ObjectType = "turn"
	Wave       ObjectType = "wave"
)

type ProtocolVersion string

const (
	The10 ProtocolVersion = "1.0"
)

type Type string

const (
	TypeAuthorityProof Type = "authority.proof"
)

type Mode string

const (
	Device Mode = "device"
)

type Kind string

const (
	Hosted Kind = "hosted"
	Remote Kind = "remote"
)
