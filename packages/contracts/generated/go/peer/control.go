// Code generated from JSON Schema; DO NOT EDIT.

package peercontracts

type PeerScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PeerNodeIdentity struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PeerChallenge struct {
	ChallengeID       string `json:"challengeId"`
	ExpiresAt         string `json:"expiresAt"`
	HostNodeID        string `json:"hostNodeId"`
	Nonce             string `json:"nonce"`
	ParticipantNodeID string `json:"participantNodeId"`
	SchemaVersion     int64  `json:"schemaVersion"`
}

type PeerProofPayload struct {
	AudienceNodeID  string  `json:"audienceNodeId"`
	ExpiresAt       string  `json:"expiresAt"`
	IssuedAt        string  `json:"issuedAt"`
	Nonce           string  `json:"nonce"`
	OperationID     string  `json:"operationId"`
	Purpose         Purpose `json:"purpose"`
	SchemaVersion   int64   `json:"schemaVersion"`
	SignerNodeID    string  `json:"signerNodeId"`
	SignerPublicKey string  `json:"signerPublicKey"`
	SubjectDigest   string  `json:"subjectDigest"`
}

type PeerProof struct {
	Payload   PeerProofPayloadClass `json:"payload"`
	Signature string                `json:"signature"`
}

type PeerProofPayloadClass struct {
	AudienceNodeID  string  `json:"audienceNodeId"`
	ExpiresAt       string  `json:"expiresAt"`
	IssuedAt        string  `json:"issuedAt"`
	Nonce           string  `json:"nonce"`
	OperationID     string  `json:"operationId"`
	Purpose         Purpose `json:"purpose"`
	SchemaVersion   int64   `json:"schemaVersion"`
	SignerNodeID    string  `json:"signerNodeId"`
	SignerPublicKey string  `json:"signerPublicKey"`
	SubjectDigest   string  `json:"subjectDigest"`
}

type PeerInvitation struct {
	ExpiresAt           string              `json:"expiresAt"`
	Host                PeerInvitationHost  `json:"host"`
	HostOrigin          string              `json:"hostOrigin"`
	InvitationID        string              `json:"invitationId"`
	MembershipExpiresAt string              `json:"membershipExpiresAt"`
	RoomLabel           *string             `json:"roomLabel"`
	SchemaVersion       int64               `json:"schemaVersion"`
	Scope               PeerInvitationScope `json:"scope"`
	TeamLabel           string              `json:"teamLabel"`
}

type PeerInvitationHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PeerInvitationScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PeerInvitationClaim struct {
	ChallengeID      string                         `json:"challengeId"`
	DisplayName      string                         `json:"displayName"`
	InvitationDigest string                         `json:"invitationDigest"`
	InvitationID     string                         `json:"invitationId"`
	LocalUserID      string                         `json:"localUserId"`
	OperationID      string                         `json:"operationId"`
	Participant      PeerInvitationClaimParticipant `json:"participant"`
	Proof            PeerInvitationClaimProof       `json:"proof"`
	SchemaVersion    int64                          `json:"schemaVersion"`
	Secret           string                         `json:"secret"`
}

type PeerInvitationClaimParticipant struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PeerInvitationClaimProof struct {
	Payload   PurplePayload `json:"payload"`
	Signature string        `json:"signature"`
}

type PurplePayload struct {
	AudienceNodeID  string  `json:"audienceNodeId"`
	ExpiresAt       string  `json:"expiresAt"`
	IssuedAt        string  `json:"issuedAt"`
	Nonce           string  `json:"nonce"`
	OperationID     string  `json:"operationId"`
	Purpose         Purpose `json:"purpose"`
	SchemaVersion   int64   `json:"schemaVersion"`
	SignerNodeID    string  `json:"signerNodeId"`
	SignerPublicKey string  `json:"signerPublicKey"`
	SubjectDigest   string  `json:"subjectDigest"`
}

type PeerMembership struct {
	CreatedAt         string              `json:"createdAt"`
	ExpiresAt         string              `json:"expiresAt"`
	HostNodeID        string              `json:"hostNodeId"`
	LocalUserID       string              `json:"localUserId"`
	MemberID          string              `json:"memberId"`
	MembershipID      string              `json:"membershipId"`
	ParticipantNodeID string              `json:"participantNodeId"`
	PeerID            string              `json:"peerId"`
	Revision          int64               `json:"revision"`
	SchemaVersion     int64               `json:"schemaVersion"`
	Scope             PeerMembershipScope `json:"scope"`
	State             PeerMembershipState `json:"state"`
	UserID            string              `json:"userId"`
}

type PeerMembershipScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PeerMachineCredential struct {
	Audience      PeerMachineCredentialAudience `json:"audience"`
	CredentialID  string                        `json:"credentialId"`
	ExpiresAt     string                        `json:"expiresAt"`
	PeerID        string                        `json:"peerId"`
	SchemaVersion int64                         `json:"schemaVersion"`
	Token         string                        `json:"token"`
}

type PeerHumanCredential struct {
	Audience      PeerHumanCredentialAudience `json:"audience"`
	CredentialID  string                      `json:"credentialId"`
	ExpiresAt     string                      `json:"expiresAt"`
	MembershipID  string                      `json:"membershipId"`
	SchemaVersion int64                       `json:"schemaVersion"`
	Scope         PeerHumanCredentialScope    `json:"scope"`
	Token         string                      `json:"token"`
}

type PeerHumanCredentialScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PeerCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type AgentExportGrant struct {
	AuthorityNodeID   string                       `json:"authorityNodeId"`
	Capabilities      AgentExportGrantCapabilities `json:"capabilities"`
	ExpiresAt         string                       `json:"expiresAt"`
	ExportID          string                       `json:"exportId"`
	IssuedAt          string                       `json:"issuedAt"`
	LocalAgentID      string                       `json:"localAgentId"`
	ParticipantNodeID string                       `json:"participantNodeId"`
	PeerID            string                       `json:"peerId"`
	Revision          int64                        `json:"revision"`
	RoomIDS           []string                     `json:"roomIds"`
	SchemaVersion     int64                        `json:"schemaVersion"`
	State             PeerMembershipState          `json:"state"`
	TeamID            string                       `json:"teamId"`
}

type AgentExportGrantCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type RemoteAgentAcceptance struct {
	AcceptanceID      string                            `json:"acceptanceId"`
	AuthorityNodeID   string                            `json:"authorityNodeId"`
	Capabilities      RemoteAgentAcceptanceCapabilities `json:"capabilities"`
	ExpiresAt         string                            `json:"expiresAt"`
	ExportID          string                            `json:"exportId"`
	GrantDigest       string                            `json:"grantDigest"`
	GrantRevision     int64                             `json:"grantRevision"`
	IssuedAt          string                            `json:"issuedAt"`
	MemberID          string                            `json:"memberId"`
	ParticipantNodeID string                            `json:"participantNodeId"`
	PeerID            string                            `json:"peerId"`
	Revision          int64                             `json:"revision"`
	RoomIDS           []string                          `json:"roomIds"`
	SchemaVersion     int64                             `json:"schemaVersion"`
	State             PeerMembershipState               `json:"state"`
	TeamID            string                            `json:"teamId"`
}

type RemoteAgentAcceptanceCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type RemoteAgentProjection struct {
	AcceptanceID       string                            `json:"acceptanceId"`
	AcceptanceRevision int64                             `json:"acceptanceRevision"`
	AuthorityNodeID    string                            `json:"authorityNodeId"`
	Capabilities       RemoteAgentProjectionCapabilities `json:"capabilities"`
	DisplayName        string                            `json:"displayName"`
	ExportID           string                            `json:"exportId"`
	LocalAgentID       string                            `json:"localAgentId"`
	PeerID             string                            `json:"peerId"`
	ProjectionAgentID  string                            `json:"projectionAgentId"`
	Role               string                            `json:"role"`
	SchemaVersion      int64                             `json:"schemaVersion"`
	TeamID             string                            `json:"teamId"`
}

type RemoteAgentProjectionCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PeerExecutionBinding struct {
	AcceptanceDigest   string `json:"acceptanceDigest"`
	AcceptanceID       string `json:"acceptanceId"`
	AcceptanceRevision int64  `json:"acceptanceRevision"`
	AuthorityNodeID    string `json:"authorityNodeId"`
	ExportID           string `json:"exportId"`
	GrantDigest        string `json:"grantDigest"`
	GrantRevision      int64  `json:"grantRevision"`
	LocalAgentID       string `json:"localAgentId"`
	ParticipantNodeID  string `json:"participantNodeId"`
	PeerID             string `json:"peerId"`
	ProjectionAgentID  string `json:"projectionAgentId"`
	RequestDigest      string `json:"requestDigest"`
	RoomID             string `json:"roomId"`
	RunID              string `json:"runId"`
	SchemaVersion      int64  `json:"schemaVersion"`
	TeamID             string `json:"teamId"`
}

type PeerAdmission struct {
	Binding       PeerAdmissionBinding `json:"binding"`
	Proof         PeerAdmissionProof   `json:"proof"`
	SchemaVersion int64                `json:"schemaVersion"`
}

type PeerAdmissionBinding struct {
	AcceptanceDigest   string `json:"acceptanceDigest"`
	AcceptanceID       string `json:"acceptanceId"`
	AcceptanceRevision int64  `json:"acceptanceRevision"`
	AuthorityNodeID    string `json:"authorityNodeId"`
	ExportID           string `json:"exportId"`
	GrantDigest        string `json:"grantDigest"`
	GrantRevision      int64  `json:"grantRevision"`
	LocalAgentID       string `json:"localAgentId"`
	ParticipantNodeID  string `json:"participantNodeId"`
	PeerID             string `json:"peerId"`
	ProjectionAgentID  string `json:"projectionAgentId"`
	RequestDigest      string `json:"requestDigest"`
	RoomID             string `json:"roomId"`
	RunID              string `json:"runId"`
	SchemaVersion      int64  `json:"schemaVersion"`
	TeamID             string `json:"teamId"`
}

type PeerAdmissionProof struct {
	Payload   FluffyPayload `json:"payload"`
	Signature string        `json:"signature"`
}

type FluffyPayload struct {
	AudienceNodeID  string  `json:"audienceNodeId"`
	ExpiresAt       string  `json:"expiresAt"`
	IssuedAt        string  `json:"issuedAt"`
	Nonce           string  `json:"nonce"`
	OperationID     string  `json:"operationId"`
	Purpose         Purpose `json:"purpose"`
	SchemaVersion   int64   `json:"schemaVersion"`
	SignerNodeID    string  `json:"signerNodeId"`
	SignerPublicKey string  `json:"signerPublicKey"`
	SubjectDigest   string  `json:"subjectDigest"`
}

type PeerSettlementCapability struct {
	Audience      PeerSettlementCapabilityAudience `json:"audience"`
	Binding       PeerSettlementCapabilityBinding  `json:"binding"`
	CapabilityID  string                           `json:"capabilityId"`
	ExpiresAt     string                           `json:"expiresAt"`
	IssuedAt      string                           `json:"issuedAt"`
	SchemaVersion int64                            `json:"schemaVersion"`
	Token         string                           `json:"token"`
}

type PeerSettlementCapabilityBinding struct {
	AcceptanceDigest   string `json:"acceptanceDigest"`
	AcceptanceID       string `json:"acceptanceId"`
	AcceptanceRevision int64  `json:"acceptanceRevision"`
	AuthorityNodeID    string `json:"authorityNodeId"`
	ExportID           string `json:"exportId"`
	GrantDigest        string `json:"grantDigest"`
	GrantRevision      int64  `json:"grantRevision"`
	LocalAgentID       string `json:"localAgentId"`
	ParticipantNodeID  string `json:"participantNodeId"`
	PeerID             string `json:"peerId"`
	ProjectionAgentID  string `json:"projectionAgentId"`
	RequestDigest      string `json:"requestDigest"`
	RoomID             string `json:"roomId"`
	RunID              string `json:"runId"`
	SchemaVersion      int64  `json:"schemaVersion"`
	TeamID             string `json:"teamId"`
}

type PeerSettlement struct {
	BindingDigest string              `json:"bindingDigest"`
	CapabilityID  string              `json:"capabilityId"`
	OperationID   string              `json:"operationId"`
	ReceiptDigest string              `json:"receiptDigest"`
	SchemaVersion int64               `json:"schemaVersion"`
	Sequence      int64               `json:"sequence"`
	State         PeerSettlementState `json:"state"`
}

type PeerError struct {
	Code Code `json:"code"`
}

type PeerControlMessage struct {
	MessageID       string                    `json:"messageId"`
	Payload         PeerControlMessagePayload `json:"payload"`
	ProtocolVersion ProtocolVersion           `json:"protocolVersion"`
	Timestamp       string                    `json:"timestamp"`
	Type            Type                      `json:"type"`
}

type PeerControlMessagePayload struct {
	ChallengeID         *string              `json:"challengeId,omitempty"`
	ExpiresAt           *string              `json:"expiresAt,omitempty"`
	HostNodeID          *string              `json:"hostNodeId,omitempty"`
	Nonce               *string              `json:"nonce,omitempty"`
	ParticipantNodeID   *string              `json:"participantNodeId,omitempty"`
	SchemaVersion       *int64               `json:"schemaVersion,omitempty"`
	Payload             *PayloadPayload      `json:"payload,omitempty"`
	Signature           *string              `json:"signature,omitempty"`
	Host                *PayloadHost         `json:"host,omitempty"`
	HostOrigin          *string              `json:"hostOrigin,omitempty"`
	InvitationID        *string              `json:"invitationId,omitempty"`
	MembershipExpiresAt *string              `json:"membershipExpiresAt,omitempty"`
	RoomLabel           *string              `json:"roomLabel"`
	Scope               *PayloadScope        `json:"scope,omitempty"`
	TeamLabel           *string              `json:"teamLabel,omitempty"`
	DisplayName         *string              `json:"displayName,omitempty"`
	InvitationDigest    *string              `json:"invitationDigest,omitempty"`
	LocalUserID         *string              `json:"localUserId,omitempty"`
	OperationID         *string              `json:"operationId,omitempty"`
	Participant         *PayloadParticipant  `json:"participant,omitempty"`
	Proof               *PayloadProof        `json:"proof,omitempty"`
	Secret              *string              `json:"secret,omitempty"`
	CreatedAt           *string              `json:"createdAt,omitempty"`
	MemberID            *string              `json:"memberId,omitempty"`
	MembershipID        *string              `json:"membershipId,omitempty"`
	PeerID              *string              `json:"peerId,omitempty"`
	Revision            *int64               `json:"revision,omitempty"`
	State               *PayloadState        `json:"state,omitempty"`
	UserID              *string              `json:"userId,omitempty"`
	AuthorityNodeID     *string              `json:"authorityNodeId,omitempty"`
	Capabilities        *PayloadCapabilities `json:"capabilities,omitempty"`
	ExportID            *string              `json:"exportId,omitempty"`
	IssuedAt            *string              `json:"issuedAt,omitempty"`
	LocalAgentID        *string              `json:"localAgentId,omitempty"`
	RoomIDS             []string             `json:"roomIds,omitempty"`
	TeamID              *string              `json:"teamId,omitempty"`
	AcceptanceID        *string              `json:"acceptanceId,omitempty"`
	GrantDigest         *string              `json:"grantDigest,omitempty"`
	GrantRevision       *int64               `json:"grantRevision,omitempty"`
	AcceptanceRevision  *int64               `json:"acceptanceRevision,omitempty"`
	ProjectionAgentID   *string              `json:"projectionAgentId,omitempty"`
	Role                *string              `json:"role,omitempty"`
	Binding             *PayloadBinding      `json:"binding,omitempty"`
	BindingDigest       *string              `json:"bindingDigest,omitempty"`
	CapabilityID        *string              `json:"capabilityId,omitempty"`
	ReceiptDigest       *string              `json:"receiptDigest,omitempty"`
	Sequence            *int64               `json:"sequence,omitempty"`
	Code                *Code                `json:"code,omitempty"`
}

type PayloadBinding struct {
	AcceptanceDigest   string `json:"acceptanceDigest"`
	AcceptanceID       string `json:"acceptanceId"`
	AcceptanceRevision int64  `json:"acceptanceRevision"`
	AuthorityNodeID    string `json:"authorityNodeId"`
	ExportID           string `json:"exportId"`
	GrantDigest        string `json:"grantDigest"`
	GrantRevision      int64  `json:"grantRevision"`
	LocalAgentID       string `json:"localAgentId"`
	ParticipantNodeID  string `json:"participantNodeId"`
	PeerID             string `json:"peerId"`
	ProjectionAgentID  string `json:"projectionAgentId"`
	RequestDigest      string `json:"requestDigest"`
	RoomID             string `json:"roomId"`
	RunID              string `json:"runId"`
	SchemaVersion      int64  `json:"schemaVersion"`
	TeamID             string `json:"teamId"`
}

type PayloadCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PayloadHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PayloadParticipant struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PayloadPayload struct {
	AudienceNodeID  string  `json:"audienceNodeId"`
	ExpiresAt       string  `json:"expiresAt"`
	IssuedAt        string  `json:"issuedAt"`
	Nonce           string  `json:"nonce"`
	OperationID     string  `json:"operationId"`
	Purpose         Purpose `json:"purpose"`
	SchemaVersion   int64   `json:"schemaVersion"`
	SignerNodeID    string  `json:"signerNodeId"`
	SignerPublicKey string  `json:"signerPublicKey"`
	SubjectDigest   string  `json:"subjectDigest"`
}

type PayloadProof struct {
	Payload   TentacledPayload `json:"payload"`
	Signature string           `json:"signature"`
}

type TentacledPayload struct {
	AudienceNodeID  string  `json:"audienceNodeId"`
	ExpiresAt       string  `json:"expiresAt"`
	IssuedAt        string  `json:"issuedAt"`
	Nonce           string  `json:"nonce"`
	OperationID     string  `json:"operationId"`
	Purpose         Purpose `json:"purpose"`
	SchemaVersion   int64   `json:"schemaVersion"`
	SignerNodeID    string  `json:"signerNodeId"`
	SignerPublicKey string  `json:"signerPublicKey"`
	SubjectDigest   string  `json:"subjectDigest"`
}

type PayloadScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PeerJoinReceipt struct {
	Invitation        PeerJoinReceiptInvitation        `json:"invitation"`
	MachineCredential PeerJoinReceiptMachineCredential `json:"machineCredential"`
	Membership        PeerJoinReceiptMembership        `json:"membership"`
	Proof             PeerJoinReceiptProof             `json:"proof"`
	SchemaVersion     int64                            `json:"schemaVersion"`
}

type PeerJoinReceiptInvitation struct {
	ExpiresAt           string      `json:"expiresAt"`
	Host                PurpleHost  `json:"host"`
	HostOrigin          string      `json:"hostOrigin"`
	InvitationID        string      `json:"invitationId"`
	MembershipExpiresAt string      `json:"membershipExpiresAt"`
	RoomLabel           *string     `json:"roomLabel"`
	SchemaVersion       int64       `json:"schemaVersion"`
	Scope               PurpleScope `json:"scope"`
	TeamLabel           string      `json:"teamLabel"`
}

type PurpleHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PurpleScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PeerJoinReceiptMachineCredential struct {
	Audience      PeerMachineCredentialAudience `json:"audience"`
	CredentialID  string                        `json:"credentialId"`
	ExpiresAt     string                        `json:"expiresAt"`
	PeerID        string                        `json:"peerId"`
	SchemaVersion int64                         `json:"schemaVersion"`
	Token         string                        `json:"token"`
}

type PeerJoinReceiptMembership struct {
	CreatedAt         string              `json:"createdAt"`
	ExpiresAt         string              `json:"expiresAt"`
	HostNodeID        string              `json:"hostNodeId"`
	LocalUserID       string              `json:"localUserId"`
	MemberID          string              `json:"memberId"`
	MembershipID      string              `json:"membershipId"`
	ParticipantNodeID string              `json:"participantNodeId"`
	PeerID            string              `json:"peerId"`
	Revision          int64               `json:"revision"`
	SchemaVersion     int64               `json:"schemaVersion"`
	Scope             FluffyScope         `json:"scope"`
	State             PeerMembershipState `json:"state"`
	UserID            string              `json:"userId"`
}

type FluffyScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PeerJoinReceiptProof struct {
	Payload   StickyPayload `json:"payload"`
	Signature string        `json:"signature"`
}

type StickyPayload struct {
	AudienceNodeID  string  `json:"audienceNodeId"`
	ExpiresAt       string  `json:"expiresAt"`
	IssuedAt        string  `json:"issuedAt"`
	Nonce           string  `json:"nonce"`
	OperationID     string  `json:"operationId"`
	Purpose         Purpose `json:"purpose"`
	SchemaVersion   int64   `json:"schemaVersion"`
	SignerNodeID    string  `json:"signerNodeId"`
	SignerPublicKey string  `json:"signerPublicKey"`
	SubjectDigest   string  `json:"subjectDigest"`
}

type PeerLocalConnection struct {
	Acceptances []PeerLocalConnectionAcceptance `json:"acceptances"`
	Exports     []PeerLocalConnectionExport     `json:"exports"`
	Receipt     PeerLocalConnectionReceipt      `json:"receipt"`
	State       PeerLocalConnectionState        `json:"state"`
}

type PeerLocalConnectionAcceptance struct {
	AcceptanceID      string              `json:"acceptanceId"`
	AuthorityNodeID   string              `json:"authorityNodeId"`
	Capabilities      PurpleCapabilities  `json:"capabilities"`
	ExpiresAt         string              `json:"expiresAt"`
	ExportID          string              `json:"exportId"`
	GrantDigest       string              `json:"grantDigest"`
	GrantRevision     int64               `json:"grantRevision"`
	IssuedAt          string              `json:"issuedAt"`
	MemberID          string              `json:"memberId"`
	ParticipantNodeID string              `json:"participantNodeId"`
	PeerID            string              `json:"peerId"`
	Revision          int64               `json:"revision"`
	RoomIDS           []string            `json:"roomIds"`
	SchemaVersion     int64               `json:"schemaVersion"`
	State             PeerMembershipState `json:"state"`
	TeamID            string              `json:"teamId"`
}

type PurpleCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PeerLocalConnectionExport struct {
	AuthorityNodeID   string              `json:"authorityNodeId"`
	Capabilities      FluffyCapabilities  `json:"capabilities"`
	ExpiresAt         string              `json:"expiresAt"`
	ExportID          string              `json:"exportId"`
	IssuedAt          string              `json:"issuedAt"`
	LocalAgentID      string              `json:"localAgentId"`
	ParticipantNodeID string              `json:"participantNodeId"`
	PeerID            string              `json:"peerId"`
	Revision          int64               `json:"revision"`
	RoomIDS           []string            `json:"roomIds"`
	SchemaVersion     int64               `json:"schemaVersion"`
	State             PeerMembershipState `json:"state"`
	TeamID            string              `json:"teamId"`
}

type FluffyCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PeerLocalConnectionReceipt struct {
	Invitation        PurpleInvitation        `json:"invitation"`
	MachineCredential PurpleMachineCredential `json:"machineCredential"`
	Membership        PurpleMembership        `json:"membership"`
	Proof             PurpleProof             `json:"proof"`
	SchemaVersion     int64                   `json:"schemaVersion"`
}

type PurpleInvitation struct {
	ExpiresAt           string         `json:"expiresAt"`
	Host                FluffyHost     `json:"host"`
	HostOrigin          string         `json:"hostOrigin"`
	InvitationID        string         `json:"invitationId"`
	MembershipExpiresAt string         `json:"membershipExpiresAt"`
	RoomLabel           *string        `json:"roomLabel"`
	SchemaVersion       int64          `json:"schemaVersion"`
	Scope               TentacledScope `json:"scope"`
	TeamLabel           string         `json:"teamLabel"`
}

type FluffyHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type TentacledScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PurpleMachineCredential struct {
	Audience      PeerMachineCredentialAudience `json:"audience"`
	CredentialID  string                        `json:"credentialId"`
	ExpiresAt     string                        `json:"expiresAt"`
	PeerID        string                        `json:"peerId"`
	SchemaVersion int64                         `json:"schemaVersion"`
	Token         string                        `json:"token"`
}

type PurpleMembership struct {
	CreatedAt         string              `json:"createdAt"`
	ExpiresAt         string              `json:"expiresAt"`
	HostNodeID        string              `json:"hostNodeId"`
	LocalUserID       string              `json:"localUserId"`
	MemberID          string              `json:"memberId"`
	MembershipID      string              `json:"membershipId"`
	ParticipantNodeID string              `json:"participantNodeId"`
	PeerID            string              `json:"peerId"`
	Revision          int64               `json:"revision"`
	SchemaVersion     int64               `json:"schemaVersion"`
	Scope             StickyScope         `json:"scope"`
	State             PeerMembershipState `json:"state"`
	UserID            string              `json:"userId"`
}

type StickyScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PurpleProof struct {
	Payload   IndigoPayload `json:"payload"`
	Signature string        `json:"signature"`
}

type IndigoPayload struct {
	AudienceNodeID  string  `json:"audienceNodeId"`
	ExpiresAt       string  `json:"expiresAt"`
	IssuedAt        string  `json:"issuedAt"`
	Nonce           string  `json:"nonce"`
	OperationID     string  `json:"operationId"`
	Purpose         Purpose `json:"purpose"`
	SchemaVersion   int64   `json:"schemaVersion"`
	SignerNodeID    string  `json:"signerNodeId"`
	SignerPublicKey string  `json:"signerPublicKey"`
	SubjectDigest   string  `json:"subjectDigest"`
}

type PeerParticipantState struct {
	Connections   []Connection                    `json:"connections"`
	LocalUserID   string                          `json:"localUserId"`
	Participant   PeerParticipantStateParticipant `json:"participant"`
	Revision      int64                           `json:"revision"`
	SchemaVersion int64                           `json:"schemaVersion"`
}

type Connection struct {
	Acceptances []ConnectionAcceptance   `json:"acceptances"`
	Exports     []ConnectionExport       `json:"exports"`
	Receipt     ConnectionReceipt        `json:"receipt"`
	State       PeerLocalConnectionState `json:"state"`
}

type ConnectionAcceptance struct {
	AcceptanceID      string                `json:"acceptanceId"`
	AuthorityNodeID   string                `json:"authorityNodeId"`
	Capabilities      TentacledCapabilities `json:"capabilities"`
	ExpiresAt         string                `json:"expiresAt"`
	ExportID          string                `json:"exportId"`
	GrantDigest       string                `json:"grantDigest"`
	GrantRevision     int64                 `json:"grantRevision"`
	IssuedAt          string                `json:"issuedAt"`
	MemberID          string                `json:"memberId"`
	ParticipantNodeID string                `json:"participantNodeId"`
	PeerID            string                `json:"peerId"`
	Revision          int64                 `json:"revision"`
	RoomIDS           []string              `json:"roomIds"`
	SchemaVersion     int64                 `json:"schemaVersion"`
	State             PeerMembershipState   `json:"state"`
	TeamID            string                `json:"teamId"`
}

type TentacledCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type ConnectionExport struct {
	AuthorityNodeID   string              `json:"authorityNodeId"`
	Capabilities      StickyCapabilities  `json:"capabilities"`
	ExpiresAt         string              `json:"expiresAt"`
	ExportID          string              `json:"exportId"`
	IssuedAt          string              `json:"issuedAt"`
	LocalAgentID      string              `json:"localAgentId"`
	ParticipantNodeID string              `json:"participantNodeId"`
	PeerID            string              `json:"peerId"`
	Revision          int64               `json:"revision"`
	RoomIDS           []string            `json:"roomIds"`
	SchemaVersion     int64               `json:"schemaVersion"`
	State             PeerMembershipState `json:"state"`
	TeamID            string              `json:"teamId"`
}

type StickyCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type ConnectionReceipt struct {
	Invitation        FluffyInvitation        `json:"invitation"`
	MachineCredential FluffyMachineCredential `json:"machineCredential"`
	Membership        FluffyMembership        `json:"membership"`
	Proof             FluffyProof             `json:"proof"`
	SchemaVersion     int64                   `json:"schemaVersion"`
}

type FluffyInvitation struct {
	ExpiresAt           string        `json:"expiresAt"`
	Host                TentacledHost `json:"host"`
	HostOrigin          string        `json:"hostOrigin"`
	InvitationID        string        `json:"invitationId"`
	MembershipExpiresAt string        `json:"membershipExpiresAt"`
	RoomLabel           *string       `json:"roomLabel"`
	SchemaVersion       int64         `json:"schemaVersion"`
	Scope               IndigoScope   `json:"scope"`
	TeamLabel           string        `json:"teamLabel"`
}

type TentacledHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type IndigoScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type FluffyMachineCredential struct {
	Audience      PeerMachineCredentialAudience `json:"audience"`
	CredentialID  string                        `json:"credentialId"`
	ExpiresAt     string                        `json:"expiresAt"`
	PeerID        string                        `json:"peerId"`
	SchemaVersion int64                         `json:"schemaVersion"`
	Token         string                        `json:"token"`
}

type FluffyMembership struct {
	CreatedAt         string              `json:"createdAt"`
	ExpiresAt         string              `json:"expiresAt"`
	HostNodeID        string              `json:"hostNodeId"`
	LocalUserID       string              `json:"localUserId"`
	MemberID          string              `json:"memberId"`
	MembershipID      string              `json:"membershipId"`
	ParticipantNodeID string              `json:"participantNodeId"`
	PeerID            string              `json:"peerId"`
	Revision          int64               `json:"revision"`
	SchemaVersion     int64               `json:"schemaVersion"`
	Scope             IndecentScope       `json:"scope"`
	State             PeerMembershipState `json:"state"`
	UserID            string              `json:"userId"`
}

type IndecentScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type FluffyProof struct {
	Payload   IndecentPayload `json:"payload"`
	Signature string          `json:"signature"`
}

type IndecentPayload struct {
	AudienceNodeID  string  `json:"audienceNodeId"`
	ExpiresAt       string  `json:"expiresAt"`
	IssuedAt        string  `json:"issuedAt"`
	Nonce           string  `json:"nonce"`
	OperationID     string  `json:"operationId"`
	Purpose         Purpose `json:"purpose"`
	SchemaVersion   int64   `json:"schemaVersion"`
	SignerNodeID    string  `json:"signerNodeId"`
	SignerPublicKey string  `json:"signerPublicKey"`
	SubjectDigest   string  `json:"subjectDigest"`
}

type PeerParticipantStateParticipant struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type Kind string

const (
	Room Kind = "room"
	Team Kind = "team"
)

type Purpose string

const (
	AgentAcceptance   Purpose = "agent.acceptance"
	AgentExport       Purpose = "agent.export"
	HumanEntry        Purpose = "human.entry"
	InvitationClaim   Purpose = "invitation.claim"
	InvitationPreview Purpose = "invitation.preview"
	PeerConnect       Purpose = "peer.connect"
	RunAdmission      Purpose = "run.admission"
	RunSettlement     Purpose = "run.settlement"
)

type PeerMembershipState string

const (
	PurpleActive  PeerMembershipState = "active"
	PurpleRevoked PeerMembershipState = "revoked"
)

type PeerMachineCredentialAudience string

const (
	PeerRuntime PeerMachineCredentialAudience = "peer.runtime"
)

type PeerHumanCredentialAudience string

const (
	PeerHuman PeerHumanCredentialAudience = "peer.human"
)

type PeerSettlementCapabilityAudience string

const (
	AudiencePeerSettlement PeerSettlementCapabilityAudience = "peer.settlement"
)

type PeerSettlementState string

const (
	PurpleCanceled       PeerSettlementState = "canceled"
	PurpleCompleted      PeerSettlementState = "completed"
	PurpleDeliveryDenied PeerSettlementState = "delivery_denied"
	PurpleExpired        PeerSettlementState = "expired"
	PurpleFailed         PeerSettlementState = "failed"
	PurpleOutcomeUnknown PeerSettlementState = "outcome_unknown"
)

type Code string

const (
	Expired               Code = "EXPIRED"
	InvalidMessage        Code = "INVALID_MESSAGE"
	PayloadConflict       Code = "PAYLOAD_CONFLICT"
	Revoked               Code = "REVOKED"
	ScopeDenied           Code = "SCOPE_DENIED"
	StaleAuthorization    Code = "STALE_AUTHORIZATION"
	Unauthenticated       Code = "UNAUTHENTICATED"
	UnsupportedCapability Code = "UNSUPPORTED_CAPABILITY"
	UnsupportedVersion    Code = "UNSUPPORTED_VERSION"
)

type PayloadState string

const (
	FluffyActive         PayloadState = "active"
	FluffyCanceled       PayloadState = "canceled"
	FluffyCompleted      PayloadState = "completed"
	FluffyDeliveryDenied PayloadState = "delivery_denied"
	FluffyExpired        PayloadState = "expired"
	FluffyFailed         PayloadState = "failed"
	FluffyOutcomeUnknown PayloadState = "outcome_unknown"
	FluffyRevoked        PayloadState = "revoked"
)

type ProtocolVersion string

const (
	PeerV1 ProtocolVersion = "peer.v1"
)

type Type string

const (
	PeerAgentAcceptance     Type = "peer.agent.acceptance"
	PeerAgentExport         Type = "peer.agent.export"
	PeerAgentProjection     Type = "peer.agent.projection"
	PeerRunAdmission        Type = "peer.run.admission"
	PeerRunSettlement       Type = "peer.run.settlement"
	TypePeerChallenge       Type = "peer.challenge"
	TypePeerError           Type = "peer.error"
	TypePeerInvitation      Type = "peer.invitation"
	TypePeerInvitationClaim Type = "peer.invitation.claim"
	TypePeerMembership      Type = "peer.membership"
	TypePeerProof           Type = "peer.proof"
)

type PeerLocalConnectionState string

const (
	Left             PeerLocalConnectionState = "left"
	TentacledActive  PeerLocalConnectionState = "active"
	TentacledRevoked PeerLocalConnectionState = "revoked"
)
