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
	MessageID                  *string                               `json:"messageId,omitempty"`
	Payload                    *PeerControlMessagePayload            `json:"payload,omitempty"`
	ProtocolVersion            *ProtocolVersion                      `json:"protocolVersion,omitempty"`
	Timestamp                  *string                               `json:"timestamp,omitempty"`
	Type                       *PeerControlMessageType               `json:"type,omitempty"`
	DisplayName                *string                               `json:"displayName,omitempty"`
	Grant                      *PeerControlMessageGrant              `json:"grant,omitempty"`
	Role                       *string                               `json:"role,omitempty"`
	SchemaVersion              *int64                                `json:"schemaVersion,omitempty"`
	Offer                      *PurpleOffer                          `json:"offer,omitempty"`
	Proof                      *PeerControlMessageProof              `json:"proof,omitempty"`
	ExportID                   *string                               `json:"exportId,omitempty"`
	GrantDigest                *string                               `json:"grantDigest,omitempty"`
	GrantRevision              *int64                                `json:"grantRevision,omitempty"`
	OfferDigest                *string                               `json:"offerDigest,omitempty"`
	Capabilities               *PeerControlMessageCapabilities       `json:"capabilities,omitempty"`
	ExpectedAcceptanceID       *string                               `json:"expectedAcceptanceId"`
	ExpectedAcceptanceRevision *int64                                `json:"expectedAcceptanceRevision"`
	ExpiresAt                  *string                               `json:"expiresAt,omitempty"`
	LocalAgentID               *string                               `json:"localAgentId,omitempty"`
	OperationID                *string                               `json:"operationId,omitempty"`
	PeerID                     *string                               `json:"peerId,omitempty"`
	RoomIDS                    []string                              `json:"roomIds,omitempty"`
	AcceptanceID               *string                               `json:"acceptanceId,omitempty"`
	ExpectedRevision           *int64                                `json:"expectedRevision,omitempty"`
	Acceptance                 *PeerControlMessageAcceptance         `json:"acceptance,omitempty"`
	Projection                 *PeerControlMessageProjection         `json:"projection,omitempty"`
	ConfigurationDigest        *string                               `json:"configurationDigest,omitempty"`
	IntentDigest               *string                               `json:"intentDigest,omitempty"`
	Offers                     []FluffyOffer                         `json:"offers,omitempty"`
	AcceptanceHistory          []PeerControlMessageAcceptanceHistory `json:"acceptanceHistory,omitempty"`
	ExportHistoryLength        *int64                                `json:"exportHistoryLength,omitempty"`
	HistoryDigest              *string                               `json:"historyDigest,omitempty"`
}

type PeerControlMessageAcceptance struct {
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

type PeerControlMessageAcceptanceHistory struct {
	Acceptance    PurpleAcceptance `json:"acceptance"`
	OfferDigest   string           `json:"offerDigest"`
	Projection    PurpleProjection `json:"projection"`
	SchemaVersion float64          `json:"schemaVersion"`
	Sequence      int64            `json:"sequence"`
}

type PurpleAcceptance struct {
	AcceptanceID      string              `json:"acceptanceId"`
	AuthorityNodeID   string              `json:"authorityNodeId"`
	Capabilities      FluffyCapabilities  `json:"capabilities"`
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

type FluffyCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PurpleProjection struct {
	AcceptanceID       string                `json:"acceptanceId"`
	AcceptanceRevision int64                 `json:"acceptanceRevision"`
	AuthorityNodeID    string                `json:"authorityNodeId"`
	Capabilities       TentacledCapabilities `json:"capabilities"`
	DisplayName        string                `json:"displayName"`
	ExportID           string                `json:"exportId"`
	LocalAgentID       string                `json:"localAgentId"`
	PeerID             string                `json:"peerId"`
	ProjectionAgentID  string                `json:"projectionAgentId"`
	Role               string                `json:"role"`
	SchemaVersion      int64                 `json:"schemaVersion"`
	TeamID             string                `json:"teamId"`
}

type TentacledCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PeerControlMessageCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PeerControlMessageGrant struct {
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

type PurpleOffer struct {
	DisplayName   string      `json:"displayName"`
	Grant         PurpleGrant `json:"grant"`
	Role          string      `json:"role"`
	SchemaVersion int64       `json:"schemaVersion"`
}

type PurpleGrant struct {
	AuthorityNodeID   string              `json:"authorityNodeId"`
	Capabilities      IndigoCapabilities  `json:"capabilities"`
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

type IndigoCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type FluffyOffer struct {
	DisplayName   string      `json:"displayName"`
	Grant         FluffyGrant `json:"grant"`
	Role          string      `json:"role"`
	SchemaVersion int64       `json:"schemaVersion"`
}

type FluffyGrant struct {
	AuthorityNodeID   string               `json:"authorityNodeId"`
	Capabilities      IndecentCapabilities `json:"capabilities"`
	ExpiresAt         string               `json:"expiresAt"`
	ExportID          string               `json:"exportId"`
	IssuedAt          string               `json:"issuedAt"`
	LocalAgentID      string               `json:"localAgentId"`
	ParticipantNodeID string               `json:"participantNodeId"`
	PeerID            string               `json:"peerId"`
	Revision          int64                `json:"revision"`
	RoomIDS           []string             `json:"roomIds"`
	SchemaVersion     int64                `json:"schemaVersion"`
	State             PeerMembershipState  `json:"state"`
	TeamID            string               `json:"teamId"`
}

type IndecentCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
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
	Proof               *PurpleProof         `json:"proof,omitempty"`
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
	Binding             *PurpleBinding       `json:"binding,omitempty"`
	BindingDigest       *string              `json:"bindingDigest,omitempty"`
	CapabilityID        *string              `json:"capabilityId,omitempty"`
	ReceiptDigest       *string              `json:"receiptDigest,omitempty"`
	Sequence            *int64               `json:"sequence,omitempty"`
	Code                *Code                `json:"code,omitempty"`
}

type PurpleBinding struct {
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

type PurpleProof struct {
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

type PeerControlMessageProjection struct {
	AcceptanceID       string                `json:"acceptanceId"`
	AcceptanceRevision int64                 `json:"acceptanceRevision"`
	AuthorityNodeID    string                `json:"authorityNodeId"`
	Capabilities       HilariousCapabilities `json:"capabilities"`
	DisplayName        string                `json:"displayName"`
	ExportID           string                `json:"exportId"`
	LocalAgentID       string                `json:"localAgentId"`
	PeerID             string                `json:"peerId"`
	ProjectionAgentID  string                `json:"projectionAgentId"`
	Role               string                `json:"role"`
	SchemaVersion      int64                 `json:"schemaVersion"`
	TeamID             string                `json:"teamId"`
}

type HilariousCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PeerControlMessageProof struct {
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

type PeerLocalConnection struct {
	Acceptances         []PeerLocalConnectionAcceptance         `json:"acceptances"`
	AcceptanceSnapshots []PeerLocalConnectionAcceptanceSnapshot `json:"acceptanceSnapshots,omitempty"`
	Exports             []PeerLocalConnectionExport             `json:"exports"`
	LocalExports        []PeerLocalConnectionLocalExport        `json:"localExports,omitempty"`
	Receipt             PeerLocalConnectionReceipt              `json:"receipt"`
	State               PeerLocalConnectionState                `json:"state"`
}

type PeerLocalConnectionAcceptanceSnapshot struct {
	AcceptanceHistory   []PurpleAcceptanceHistory `json:"acceptanceHistory"`
	ExportHistoryLength int64                     `json:"exportHistoryLength"`
	ExportID            string                    `json:"exportId"`
	GrantDigest         string                    `json:"grantDigest"`
	GrantRevision       int64                     `json:"grantRevision"`
	HistoryDigest       string                    `json:"historyDigest"`
	LocalAgentID        string                    `json:"localAgentId"`
	PeerID              string                    `json:"peerId"`
	Proof               FluffyProof               `json:"proof"`
	SchemaVersion       int64                     `json:"schemaVersion"`
}

type PurpleAcceptanceHistory struct {
	Acceptance    FluffyAcceptance `json:"acceptance"`
	OfferDigest   string           `json:"offerDigest"`
	Projection    FluffyProjection `json:"projection"`
	SchemaVersion float64          `json:"schemaVersion"`
	Sequence      int64            `json:"sequence"`
}

type FluffyAcceptance struct {
	AcceptanceID      string                `json:"acceptanceId"`
	AuthorityNodeID   string                `json:"authorityNodeId"`
	Capabilities      AmbitiousCapabilities `json:"capabilities"`
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

type AmbitiousCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type FluffyProjection struct {
	AcceptanceID       string              `json:"acceptanceId"`
	AcceptanceRevision int64               `json:"acceptanceRevision"`
	AuthorityNodeID    string              `json:"authorityNodeId"`
	Capabilities       CunningCapabilities `json:"capabilities"`
	DisplayName        string              `json:"displayName"`
	ExportID           string              `json:"exportId"`
	LocalAgentID       string              `json:"localAgentId"`
	PeerID             string              `json:"peerId"`
	ProjectionAgentID  string              `json:"projectionAgentId"`
	Role               string              `json:"role"`
	SchemaVersion      int64               `json:"schemaVersion"`
	TeamID             string              `json:"teamId"`
}

type CunningCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
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

type PeerLocalConnectionAcceptance struct {
	AcceptanceID      string              `json:"acceptanceId"`
	AuthorityNodeID   string              `json:"authorityNodeId"`
	Capabilities      MagentaCapabilities `json:"capabilities"`
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

type MagentaCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PeerLocalConnectionExport struct {
	AuthorityNodeID   string              `json:"authorityNodeId"`
	Capabilities      FriskyCapabilities  `json:"capabilities"`
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

type FriskyCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PeerLocalConnectionLocalExport struct {
	ConfigurationDigest string         `json:"configurationDigest"`
	IntentDigest        string         `json:"intentDigest"`
	Offer               TentacledOffer `json:"offer"`
	OperationID         string         `json:"operationId"`
	SchemaVersion       int64          `json:"schemaVersion"`
}

type TentacledOffer struct {
	DisplayName   string         `json:"displayName"`
	Grant         TentacledGrant `json:"grant"`
	Role          string         `json:"role"`
	SchemaVersion int64          `json:"schemaVersion"`
}

type TentacledGrant struct {
	AuthorityNodeID   string                  `json:"authorityNodeId"`
	Capabilities      MischievousCapabilities `json:"capabilities"`
	ExpiresAt         string                  `json:"expiresAt"`
	ExportID          string                  `json:"exportId"`
	IssuedAt          string                  `json:"issuedAt"`
	LocalAgentID      string                  `json:"localAgentId"`
	ParticipantNodeID string                  `json:"participantNodeId"`
	PeerID            string                  `json:"peerId"`
	Revision          int64                   `json:"revision"`
	RoomIDS           []string                `json:"roomIds"`
	SchemaVersion     int64                   `json:"schemaVersion"`
	State             PeerMembershipState     `json:"state"`
	TeamID            string                  `json:"teamId"`
}

type MischievousCapabilities struct {
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
	Proof             TentacledProof          `json:"proof"`
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

type TentacledProof struct {
	Payload   HilariousPayload `json:"payload"`
	Signature string           `json:"signature"`
}

type HilariousPayload struct {
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
	Acceptances         []ConnectionAcceptance         `json:"acceptances"`
	AcceptanceSnapshots []ConnectionAcceptanceSnapshot `json:"acceptanceSnapshots,omitempty"`
	Exports             []ConnectionExport             `json:"exports"`
	LocalExports        []ConnectionLocalExport        `json:"localExports,omitempty"`
	Receipt             ConnectionReceipt              `json:"receipt"`
	State               PeerLocalConnectionState       `json:"state"`
}

type ConnectionAcceptanceSnapshot struct {
	AcceptanceHistory   []FluffyAcceptanceHistory `json:"acceptanceHistory"`
	ExportHistoryLength int64                     `json:"exportHistoryLength"`
	ExportID            string                    `json:"exportId"`
	GrantDigest         string                    `json:"grantDigest"`
	GrantRevision       int64                     `json:"grantRevision"`
	HistoryDigest       string                    `json:"historyDigest"`
	LocalAgentID        string                    `json:"localAgentId"`
	PeerID              string                    `json:"peerId"`
	Proof               StickyProof               `json:"proof"`
	SchemaVersion       int64                     `json:"schemaVersion"`
}

type FluffyAcceptanceHistory struct {
	Acceptance    TentacledAcceptance `json:"acceptance"`
	OfferDigest   string              `json:"offerDigest"`
	Projection    TentacledProjection `json:"projection"`
	SchemaVersion float64             `json:"schemaVersion"`
	Sequence      int64               `json:"sequence"`
}

type TentacledAcceptance struct {
	AcceptanceID      string                    `json:"acceptanceId"`
	AuthorityNodeID   string                    `json:"authorityNodeId"`
	Capabilities      BraggadociousCapabilities `json:"capabilities"`
	ExpiresAt         string                    `json:"expiresAt"`
	ExportID          string                    `json:"exportId"`
	GrantDigest       string                    `json:"grantDigest"`
	GrantRevision     int64                     `json:"grantRevision"`
	IssuedAt          string                    `json:"issuedAt"`
	MemberID          string                    `json:"memberId"`
	ParticipantNodeID string                    `json:"participantNodeId"`
	PeerID            string                    `json:"peerId"`
	Revision          int64                     `json:"revision"`
	RoomIDS           []string                  `json:"roomIds"`
	SchemaVersion     int64                     `json:"schemaVersion"`
	State             PeerMembershipState       `json:"state"`
	TeamID            string                    `json:"teamId"`
}

type BraggadociousCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type TentacledProjection struct {
	AcceptanceID       string        `json:"acceptanceId"`
	AcceptanceRevision int64         `json:"acceptanceRevision"`
	AuthorityNodeID    string        `json:"authorityNodeId"`
	Capabilities       Capabilities1 `json:"capabilities"`
	DisplayName        string        `json:"displayName"`
	ExportID           string        `json:"exportId"`
	LocalAgentID       string        `json:"localAgentId"`
	PeerID             string        `json:"peerId"`
	ProjectionAgentID  string        `json:"projectionAgentId"`
	Role               string        `json:"role"`
	SchemaVersion      int64         `json:"schemaVersion"`
	TeamID             string        `json:"teamId"`
}

type Capabilities1 struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type StickyProof struct {
	Payload   AmbitiousPayload `json:"payload"`
	Signature string           `json:"signature"`
}

type AmbitiousPayload struct {
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

type ConnectionAcceptance struct {
	AcceptanceID      string              `json:"acceptanceId"`
	AuthorityNodeID   string              `json:"authorityNodeId"`
	Capabilities      Capabilities2       `json:"capabilities"`
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

type Capabilities2 struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type ConnectionExport struct {
	AuthorityNodeID   string              `json:"authorityNodeId"`
	Capabilities      Capabilities3       `json:"capabilities"`
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

type Capabilities3 struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type ConnectionLocalExport struct {
	ConfigurationDigest string      `json:"configurationDigest"`
	IntentDigest        string      `json:"intentDigest"`
	Offer               StickyOffer `json:"offer"`
	OperationID         string      `json:"operationId"`
	SchemaVersion       int64       `json:"schemaVersion"`
}

type StickyOffer struct {
	DisplayName   string      `json:"displayName"`
	Grant         StickyGrant `json:"grant"`
	Role          string      `json:"role"`
	SchemaVersion int64       `json:"schemaVersion"`
}

type StickyGrant struct {
	AuthorityNodeID   string              `json:"authorityNodeId"`
	Capabilities      Capabilities4       `json:"capabilities"`
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

type Capabilities4 struct {
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
	Proof             IndigoProof             `json:"proof"`
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

type IndigoProof struct {
	Payload   CunningPayload `json:"payload"`
	Signature string         `json:"signature"`
}

type CunningPayload struct {
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

type PeerInvitationCreateRequest struct {
	ExpiresAt           string                           `json:"expiresAt"`
	MembershipExpiresAt string                           `json:"membershipExpiresAt"`
	OperationID         string                           `json:"operationId"`
	SchemaVersion       int64                            `json:"schemaVersion"`
	Scope               PeerInvitationCreateRequestScope `json:"scope"`
}

type PeerInvitationCreateRequestScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PeerInvitationIssued struct {
	Invitation    PeerInvitationIssuedInvitation `json:"invitation"`
	SchemaVersion int64                          `json:"schemaVersion"`
	Secret        string                         `json:"secret"`
}

type PeerInvitationIssuedInvitation struct {
	ExpiresAt           string         `json:"expiresAt"`
	Host                StickyHost     `json:"host"`
	HostOrigin          string         `json:"hostOrigin"`
	InvitationID        string         `json:"invitationId"`
	MembershipExpiresAt string         `json:"membershipExpiresAt"`
	RoomLabel           *string        `json:"roomLabel"`
	SchemaVersion       int64          `json:"schemaVersion"`
	Scope               HilariousScope `json:"scope"`
	TeamLabel           string         `json:"teamLabel"`
}

type StickyHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type HilariousScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PeerInvitationPreviewRequest struct {
	InvitationID  string                                  `json:"invitationId"`
	Nonce         string                                  `json:"nonce"`
	OperationID   string                                  `json:"operationId"`
	Participant   PeerInvitationPreviewRequestParticipant `json:"participant"`
	SchemaVersion int64                                   `json:"schemaVersion"`
	Secret        string                                  `json:"secret"`
}

type PeerInvitationPreviewRequestParticipant struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PeerInvitationPreview struct {
	Invitation    PeerInvitationPreviewInvitation `json:"invitation"`
	Proof         PeerInvitationPreviewProof      `json:"proof"`
	SchemaVersion int64                           `json:"schemaVersion"`
}

type PeerInvitationPreviewInvitation struct {
	ExpiresAt           string         `json:"expiresAt"`
	Host                IndigoHost     `json:"host"`
	HostOrigin          string         `json:"hostOrigin"`
	InvitationID        string         `json:"invitationId"`
	MembershipExpiresAt string         `json:"membershipExpiresAt"`
	RoomLabel           *string        `json:"roomLabel"`
	SchemaVersion       int64          `json:"schemaVersion"`
	Scope               AmbitiousScope `json:"scope"`
	TeamLabel           string         `json:"teamLabel"`
}

type IndigoHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type AmbitiousScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PeerInvitationPreviewProof struct {
	Payload   MagentaPayload `json:"payload"`
	Signature string         `json:"signature"`
}

type MagentaPayload struct {
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

type PeerClaimChallengeRequest struct {
	InvitationID  string                               `json:"invitationId"`
	OperationID   string                               `json:"operationId"`
	Participant   PeerClaimChallengeRequestParticipant `json:"participant"`
	SchemaVersion int64                                `json:"schemaVersion"`
	Secret        string                               `json:"secret"`
	SubjectDigest string                               `json:"subjectDigest"`
}

type PeerClaimChallengeRequestParticipant struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PeerHumanBindingCredential struct {
	Audience      PeerHumanBindingCredentialAudience `json:"audience"`
	CredentialID  string                             `json:"credentialId"`
	ExpiresAt     string                             `json:"expiresAt"`
	MembershipID  string                             `json:"membershipId"`
	SchemaVersion int64                              `json:"schemaVersion"`
	Scope         PeerHumanBindingCredentialScope    `json:"scope"`
	Token         string                             `json:"token"`
}

type PeerHumanBindingCredentialScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PeerHumanBindingReceipt struct {
	Host              PeerHumanBindingReceiptHost            `json:"host"`
	HumanCredential   PeerHumanBindingReceiptHumanCredential `json:"humanCredential"`
	JoinReceiptDigest string                                 `json:"joinReceiptDigest"`
	LocalUserID       string                                 `json:"localUserId"`
	Participant       PeerHumanBindingReceiptParticipant     `json:"participant"`
	Proof             PeerHumanBindingReceiptProof           `json:"proof"`
	SchemaVersion     int64                                  `json:"schemaVersion"`
}

type PeerHumanBindingReceiptHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PeerHumanBindingReceiptHumanCredential struct {
	Audience      PeerHumanBindingCredentialAudience `json:"audience"`
	CredentialID  string                             `json:"credentialId"`
	ExpiresAt     string                             `json:"expiresAt"`
	MembershipID  string                             `json:"membershipId"`
	SchemaVersion int64                              `json:"schemaVersion"`
	Scope         CunningScope                       `json:"scope"`
	Token         string                             `json:"token"`
}

type CunningScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PeerHumanBindingReceiptParticipant struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PeerHumanBindingReceiptProof struct {
	Payload   FriskyPayload `json:"payload"`
	Signature string        `json:"signature"`
}

type FriskyPayload struct {
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

type PeerJoined struct {
	Human         Human   `json:"human"`
	Runtime       Runtime `json:"runtime"`
	SchemaVersion int64   `json:"schemaVersion"`
}

type Human struct {
	Host              HumanHost            `json:"host"`
	HumanCredential   HumanHumanCredential `json:"humanCredential"`
	JoinReceiptDigest string               `json:"joinReceiptDigest"`
	LocalUserID       string               `json:"localUserId"`
	Participant       HumanParticipant     `json:"participant"`
	Proof             HumanProof           `json:"proof"`
	SchemaVersion     int64                `json:"schemaVersion"`
}

type HumanHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type HumanHumanCredential struct {
	Audience      PeerHumanBindingCredentialAudience `json:"audience"`
	CredentialID  string                             `json:"credentialId"`
	ExpiresAt     string                             `json:"expiresAt"`
	MembershipID  string                             `json:"membershipId"`
	SchemaVersion int64                              `json:"schemaVersion"`
	Scope         MagentaScope                       `json:"scope"`
	Token         string                             `json:"token"`
}

type MagentaScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type HumanParticipant struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type HumanProof struct {
	Payload   MischievousPayload `json:"payload"`
	Signature string             `json:"signature"`
}

type MischievousPayload struct {
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

type Runtime struct {
	Invitation        RuntimeInvitation        `json:"invitation"`
	MachineCredential RuntimeMachineCredential `json:"machineCredential"`
	Membership        RuntimeMembership        `json:"membership"`
	Proof             RuntimeProof             `json:"proof"`
	SchemaVersion     int64                    `json:"schemaVersion"`
}

type RuntimeInvitation struct {
	ExpiresAt           string       `json:"expiresAt"`
	Host                IndecentHost `json:"host"`
	HostOrigin          string       `json:"hostOrigin"`
	InvitationID        string       `json:"invitationId"`
	MembershipExpiresAt string       `json:"membershipExpiresAt"`
	RoomLabel           *string      `json:"roomLabel"`
	SchemaVersion       int64        `json:"schemaVersion"`
	Scope               FriskyScope  `json:"scope"`
	TeamLabel           string       `json:"teamLabel"`
}

type IndecentHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type FriskyScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type RuntimeMachineCredential struct {
	Audience      PeerMachineCredentialAudience `json:"audience"`
	CredentialID  string                        `json:"credentialId"`
	ExpiresAt     string                        `json:"expiresAt"`
	PeerID        string                        `json:"peerId"`
	SchemaVersion int64                         `json:"schemaVersion"`
	Token         string                        `json:"token"`
}

type RuntimeMembership struct {
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
	Scope             MischievousScope    `json:"scope"`
	State             PeerMembershipState `json:"state"`
	UserID            string              `json:"userId"`
}

type MischievousScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type RuntimeProof struct {
	Payload   BraggadociousPayload `json:"payload"`
	Signature string               `json:"signature"`
}

type BraggadociousPayload struct {
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

type PeerHumanEntryRequest struct {
	BindingCredentialID string                     `json:"bindingCredentialId"`
	BindingToken        string                     `json:"bindingToken"`
	Nonce               string                     `json:"nonce"`
	OperationID         string                     `json:"operationId"`
	Proof               PeerHumanEntryRequestProof `json:"proof"`
	SchemaVersion       int64                      `json:"schemaVersion"`
	Scope               PeerHumanEntryRequestScope `json:"scope"`
}

type PeerHumanEntryRequestProof struct {
	Payload   Payload1 `json:"payload"`
	Signature string   `json:"signature"`
}

type Payload1 struct {
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

type PeerHumanEntryRequestScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PeerHumanEntry struct {
	Credential        Credential          `json:"credential"`
	ExchangeExpiresAt string              `json:"exchangeExpiresAt"`
	HostOrigin        string              `json:"hostOrigin"`
	Proof             PeerHumanEntryProof `json:"proof"`
	SchemaVersion     int64               `json:"schemaVersion"`
}

type Credential struct {
	Audience      PeerHumanCredentialAudience `json:"audience"`
	CredentialID  string                      `json:"credentialId"`
	ExpiresAt     string                      `json:"expiresAt"`
	MembershipID  string                      `json:"membershipId"`
	SchemaVersion int64                       `json:"schemaVersion"`
	Scope         CredentialScope             `json:"scope"`
	Token         string                      `json:"token"`
}

type CredentialScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PeerHumanEntryProof struct {
	Payload   Payload2 `json:"payload"`
	Signature string   `json:"signature"`
}

type Payload2 struct {
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

type PeerBrowserEntryRequest struct {
	CredentialID  string `json:"credentialId"`
	SchemaVersion int64  `json:"schemaVersion"`
	Token         string `json:"token"`
}

type PeerHumanEntryIdentity struct {
	DisplayName   string                      `json:"displayName"`
	MemberID      string                      `json:"memberId"`
	MembershipID  string                      `json:"membershipId"`
	RoomLabel     *string                     `json:"roomLabel"`
	SchemaVersion int64                       `json:"schemaVersion"`
	Scope         PeerHumanEntryIdentityScope `json:"scope"`
	TeamLabel     string                      `json:"teamLabel"`
	UserID        string                      `json:"userId"`
}

type PeerHumanEntryIdentityScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PeerIdentityRequest struct {
	Nonce         string                         `json:"nonce"`
	OperationID   string                         `json:"operationId"`
	Participant   PeerIdentityRequestParticipant `json:"participant"`
	SchemaVersion int64                          `json:"schemaVersion"`
}

type PeerIdentityRequestParticipant struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PeerIdentityProof struct {
	Host          PeerIdentityProofHost  `json:"host"`
	HostOrigin    string                 `json:"hostOrigin"`
	Proof         PeerIdentityProofProof `json:"proof"`
	SchemaVersion int64                  `json:"schemaVersion"`
}

type PeerIdentityProofHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PeerIdentityProofProof struct {
	Payload   Payload3 `json:"payload"`
	Signature string   `json:"signature"`
}

type Payload3 struct {
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

type PeerLocalHumanBinding struct {
	Receipt PeerLocalHumanBindingReceipt `json:"receipt"`
	State   PeerMembershipState          `json:"state"`
}

type PeerLocalHumanBindingReceipt struct {
	Host              HilariousHost         `json:"host"`
	HumanCredential   PurpleHumanCredential `json:"humanCredential"`
	JoinReceiptDigest string                `json:"joinReceiptDigest"`
	LocalUserID       string                `json:"localUserId"`
	Participant       PurpleParticipant     `json:"participant"`
	Proof             IndecentProof         `json:"proof"`
	SchemaVersion     int64                 `json:"schemaVersion"`
}

type HilariousHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PurpleHumanCredential struct {
	Audience      PeerHumanBindingCredentialAudience `json:"audience"`
	CredentialID  string                             `json:"credentialId"`
	ExpiresAt     string                             `json:"expiresAt"`
	MembershipID  string                             `json:"membershipId"`
	SchemaVersion int64                              `json:"schemaVersion"`
	Scope         BraggadociousScope                 `json:"scope"`
	Token         string                             `json:"token"`
}

type BraggadociousScope struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PurpleParticipant struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type IndecentProof struct {
	Payload   Payload4 `json:"payload"`
	Signature string   `json:"signature"`
}

type Payload4 struct {
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

type PeerHumanVaultState struct {
	Bindings      []BindingElement               `json:"bindings"`
	LocalUserID   string                         `json:"localUserId"`
	Participant   PeerHumanVaultStateParticipant `json:"participant"`
	Revision      int64                          `json:"revision"`
	SchemaVersion int64                          `json:"schemaVersion"`
}

type BindingElement struct {
	Receipt BindingReceipt      `json:"receipt"`
	State   PeerMembershipState `json:"state"`
}

type BindingReceipt struct {
	Host              AmbitiousHost         `json:"host"`
	HumanCredential   FluffyHumanCredential `json:"humanCredential"`
	JoinReceiptDigest string                `json:"joinReceiptDigest"`
	LocalUserID       string                `json:"localUserId"`
	Participant       FluffyParticipant     `json:"participant"`
	Proof             HilariousProof        `json:"proof"`
	SchemaVersion     int64                 `json:"schemaVersion"`
}

type AmbitiousHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type FluffyHumanCredential struct {
	Audience      PeerHumanBindingCredentialAudience `json:"audience"`
	CredentialID  string                             `json:"credentialId"`
	ExpiresAt     string                             `json:"expiresAt"`
	MembershipID  string                             `json:"membershipId"`
	SchemaVersion int64                              `json:"schemaVersion"`
	Scope         Scope1                             `json:"scope"`
	Token         string                             `json:"token"`
}

type Scope1 struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type FluffyParticipant struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type HilariousProof struct {
	Payload   Payload5 `json:"payload"`
	Signature string   `json:"signature"`
}

type Payload5 struct {
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

type PeerHumanVaultStateParticipant struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PeerPendingJoin struct {
	CreatedAt     string                     `json:"createdAt"`
	DisplayName   string                     `json:"displayName"`
	Invitation    PeerPendingJoinInvitation  `json:"invitation"`
	LocalUserID   string                     `json:"localUserId"`
	OperationID   string                     `json:"operationId"`
	Participant   PeerPendingJoinParticipant `json:"participant"`
	PreviewProof  PreviewProof               `json:"previewProof"`
	SchemaVersion int64                      `json:"schemaVersion"`
	Secret        string                     `json:"secret"`
}

type PeerPendingJoinInvitation struct {
	ExpiresAt           string      `json:"expiresAt"`
	Host                CunningHost `json:"host"`
	HostOrigin          string      `json:"hostOrigin"`
	InvitationID        string      `json:"invitationId"`
	MembershipExpiresAt string      `json:"membershipExpiresAt"`
	RoomLabel           *string     `json:"roomLabel"`
	SchemaVersion       int64       `json:"schemaVersion"`
	Scope               Scope2      `json:"scope"`
	TeamLabel           string      `json:"teamLabel"`
}

type CunningHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type Scope2 struct {
	Kind   Kind    `json:"kind"`
	RoomID *string `json:"roomId"`
	TeamID string  `json:"teamId"`
}

type PeerPendingJoinParticipant struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PreviewProof struct {
	Payload   PreviewProofPayload `json:"payload"`
	Signature string              `json:"signature"`
}

type PreviewProofPayload struct {
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

type PeerAgentOffer struct {
	DisplayName   string              `json:"displayName"`
	Grant         PeerAgentOfferGrant `json:"grant"`
	Role          string              `json:"role"`
	SchemaVersion int64               `json:"schemaVersion"`
}

type PeerAgentOfferGrant struct {
	AuthorityNodeID   string              `json:"authorityNodeId"`
	Capabilities      Capabilities5       `json:"capabilities"`
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

type Capabilities5 struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PeerAgentOfferRequest struct {
	Offer         PeerAgentOfferRequestOffer `json:"offer"`
	Proof         PeerAgentOfferRequestProof `json:"proof"`
	SchemaVersion int64                      `json:"schemaVersion"`
}

type PeerAgentOfferRequestOffer struct {
	DisplayName   string      `json:"displayName"`
	Grant         IndigoGrant `json:"grant"`
	Role          string      `json:"role"`
	SchemaVersion int64       `json:"schemaVersion"`
}

type IndigoGrant struct {
	AuthorityNodeID   string              `json:"authorityNodeId"`
	Capabilities      Capabilities6       `json:"capabilities"`
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

type Capabilities6 struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PeerAgentOfferRequestProof struct {
	Payload   Payload6 `json:"payload"`
	Signature string   `json:"signature"`
}

type Payload6 struct {
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

type PeerAgentOfferReceipt struct {
	ExportID      string                     `json:"exportId"`
	GrantDigest   string                     `json:"grantDigest"`
	GrantRevision int64                      `json:"grantRevision"`
	OfferDigest   string                     `json:"offerDigest"`
	Proof         PeerAgentOfferReceiptProof `json:"proof"`
	SchemaVersion int64                      `json:"schemaVersion"`
}

type PeerAgentOfferReceiptProof struct {
	Payload   Payload7 `json:"payload"`
	Signature string   `json:"signature"`
}

type Payload7 struct {
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

type PeerAgentAcceptanceRequest struct {
	Capabilities               PeerAgentAcceptanceRequestCapabilities `json:"capabilities"`
	ExpectedAcceptanceID       *string                                `json:"expectedAcceptanceId"`
	ExpectedAcceptanceRevision *int64                                 `json:"expectedAcceptanceRevision"`
	ExpiresAt                  string                                 `json:"expiresAt"`
	ExportID                   string                                 `json:"exportId"`
	GrantDigest                string                                 `json:"grantDigest"`
	GrantRevision              int64                                  `json:"grantRevision"`
	LocalAgentID               string                                 `json:"localAgentId"`
	OfferDigest                string                                 `json:"offerDigest"`
	OperationID                string                                 `json:"operationId"`
	PeerID                     string                                 `json:"peerId"`
	RoomIDS                    []string                               `json:"roomIds"`
	SchemaVersion              int64                                  `json:"schemaVersion"`
}

type PeerAgentAcceptanceRequestCapabilities struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PeerAgentRevokeRequest struct {
	AcceptanceID     string `json:"acceptanceId"`
	ExpectedRevision int64  `json:"expectedRevision"`
	OperationID      string `json:"operationId"`
	SchemaVersion    int64  `json:"schemaVersion"`
}

type PeerAgentAcceptanceReceipt struct {
	Acceptance    PeerAgentAcceptanceReceiptAcceptance `json:"acceptance"`
	OfferDigest   string                               `json:"offerDigest"`
	Projection    PeerAgentAcceptanceReceiptProjection `json:"projection"`
	Proof         PeerAgentAcceptanceReceiptProof      `json:"proof"`
	SchemaVersion int64                                `json:"schemaVersion"`
}

type PeerAgentAcceptanceReceiptAcceptance struct {
	AcceptanceID      string              `json:"acceptanceId"`
	AuthorityNodeID   string              `json:"authorityNodeId"`
	Capabilities      Capabilities7       `json:"capabilities"`
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

type Capabilities7 struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PeerAgentAcceptanceReceiptProjection struct {
	AcceptanceID       string        `json:"acceptanceId"`
	AcceptanceRevision int64         `json:"acceptanceRevision"`
	AuthorityNodeID    string        `json:"authorityNodeId"`
	Capabilities       Capabilities8 `json:"capabilities"`
	DisplayName        string        `json:"displayName"`
	ExportID           string        `json:"exportId"`
	LocalAgentID       string        `json:"localAgentId"`
	PeerID             string        `json:"peerId"`
	ProjectionAgentID  string        `json:"projectionAgentId"`
	Role               string        `json:"role"`
	SchemaVersion      int64         `json:"schemaVersion"`
	TeamID             string        `json:"teamId"`
}

type Capabilities8 struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PeerAgentAcceptanceReceiptProof struct {
	Payload   Payload8 `json:"payload"`
	Signature string   `json:"signature"`
}

type Payload8 struct {
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

type PeerLocalExport struct {
	ConfigurationDigest string               `json:"configurationDigest"`
	IntentDigest        string               `json:"intentDigest"`
	Offer               PeerLocalExportOffer `json:"offer"`
	OperationID         string               `json:"operationId"`
	SchemaVersion       int64                `json:"schemaVersion"`
}

type PeerLocalExportOffer struct {
	DisplayName   string        `json:"displayName"`
	Grant         IndecentGrant `json:"grant"`
	Role          string        `json:"role"`
	SchemaVersion int64         `json:"schemaVersion"`
}

type IndecentGrant struct {
	AuthorityNodeID   string              `json:"authorityNodeId"`
	Capabilities      Capabilities9       `json:"capabilities"`
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

type Capabilities9 struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PeerAgentSyncRequest struct {
	LocalAgentID  string                      `json:"localAgentId"`
	Offers        []PeerAgentSyncRequestOffer `json:"offers"`
	Proof         PeerAgentSyncRequestProof   `json:"proof"`
	SchemaVersion int64                       `json:"schemaVersion"`
}

type PeerAgentSyncRequestOffer struct {
	DisplayName   string         `json:"displayName"`
	Grant         HilariousGrant `json:"grant"`
	Role          string         `json:"role"`
	SchemaVersion int64          `json:"schemaVersion"`
}

type HilariousGrant struct {
	AuthorityNodeID   string              `json:"authorityNodeId"`
	Capabilities      Capabilities10      `json:"capabilities"`
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

type Capabilities10 struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PeerAgentSyncRequestProof struct {
	Payload   Payload9 `json:"payload"`
	Signature string   `json:"signature"`
}

type Payload9 struct {
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

type PeerAgentSyncReceipt struct {
	AcceptanceHistory   []PeerAgentSyncReceiptAcceptanceHistory `json:"acceptanceHistory"`
	ExportHistoryLength int64                                   `json:"exportHistoryLength"`
	ExportID            string                                  `json:"exportId"`
	GrantDigest         string                                  `json:"grantDigest"`
	GrantRevision       int64                                   `json:"grantRevision"`
	HistoryDigest       string                                  `json:"historyDigest"`
	LocalAgentID        string                                  `json:"localAgentId"`
	PeerID              string                                  `json:"peerId"`
	Proof               PeerAgentSyncReceiptProof               `json:"proof"`
	SchemaVersion       int64                                   `json:"schemaVersion"`
}

type PeerAgentSyncReceiptAcceptanceHistory struct {
	Acceptance    StickyAcceptance `json:"acceptance"`
	OfferDigest   string           `json:"offerDigest"`
	Projection    StickyProjection `json:"projection"`
	SchemaVersion float64          `json:"schemaVersion"`
	Sequence      int64            `json:"sequence"`
}

type StickyAcceptance struct {
	AcceptanceID      string              `json:"acceptanceId"`
	AuthorityNodeID   string              `json:"authorityNodeId"`
	Capabilities      Capabilities11      `json:"capabilities"`
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

type Capabilities11 struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type StickyProjection struct {
	AcceptanceID       string         `json:"acceptanceId"`
	AcceptanceRevision int64          `json:"acceptanceRevision"`
	AuthorityNodeID    string         `json:"authorityNodeId"`
	Capabilities       Capabilities12 `json:"capabilities"`
	DisplayName        string         `json:"displayName"`
	ExportID           string         `json:"exportId"`
	LocalAgentID       string         `json:"localAgentId"`
	PeerID             string         `json:"peerId"`
	ProjectionAgentID  string         `json:"projectionAgentId"`
	Role               string         `json:"role"`
	SchemaVersion      int64          `json:"schemaVersion"`
	TeamID             string         `json:"teamId"`
}

type Capabilities12 struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PeerAgentSyncReceiptProof struct {
	Payload   Payload10 `json:"payload"`
	Signature string    `json:"signature"`
}

type Payload10 struct {
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

type PeerAgentAcceptanceRecord struct {
	Acceptance    PeerAgentAcceptanceRecordAcceptance `json:"acceptance"`
	OfferDigest   string                              `json:"offerDigest"`
	Projection    PeerAgentAcceptanceRecordProjection `json:"projection"`
	SchemaVersion float64                             `json:"schemaVersion"`
	Sequence      int64                               `json:"sequence"`
}

type PeerAgentAcceptanceRecordAcceptance struct {
	AcceptanceID      string              `json:"acceptanceId"`
	AuthorityNodeID   string              `json:"authorityNodeId"`
	Capabilities      Capabilities13      `json:"capabilities"`
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

type Capabilities13 struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PeerAgentAcceptanceRecordProjection struct {
	AcceptanceID       string         `json:"acceptanceId"`
	AcceptanceRevision int64          `json:"acceptanceRevision"`
	AuthorityNodeID    string         `json:"authorityNodeId"`
	Capabilities       Capabilities14 `json:"capabilities"`
	DisplayName        string         `json:"displayName"`
	ExportID           string         `json:"exportId"`
	LocalAgentID       string         `json:"localAgentId"`
	PeerID             string         `json:"peerId"`
	ProjectionAgentID  string         `json:"projectionAgentId"`
	Role               string         `json:"role"`
	SchemaVersion      int64          `json:"schemaVersion"`
	TeamID             string         `json:"teamId"`
}

type Capabilities14 struct {
	SupportsInterrupt            bool `json:"supportsInterrupt"`
	SupportsOwnerPrivateOutput   bool `json:"supportsOwnerPrivateOutput"`
	SupportsResume               bool `json:"supportsResume"`
	SupportsStart                bool `json:"supportsStart"`
	SupportsStreaming            bool `json:"supportsStreaming"`
	SupportsTaskContextIsolation bool `json:"supportsTaskContextIsolation"`
}

type PeerIngressConfiguration struct {
	CertificateFile string  `json:"certificateFile"`
	Enabled         bool    `json:"enabled"`
	ListenHost      string  `json:"listenHost"`
	Origin          string  `json:"origin"`
	PrivateKeyFile  string  `json:"privateKeyFile"`
	SchemaVersion   float64 `json:"schemaVersion"`
}

type PeerRuntimeBinding struct {
	ConnectionID  string                        `json:"connectionId"`
	CredentialID  string                        `json:"credentialId"`
	Host          PeerRuntimeBindingHost        `json:"host"`
	HostOrigin    string                        `json:"hostOrigin"`
	MemberID      string                        `json:"memberId"`
	MembershipID  string                        `json:"membershipId"`
	OperationID   string                        `json:"operationId"`
	Participant   PeerRuntimeBindingParticipant `json:"participant"`
	PeerID        string                        `json:"peerId"`
	SchemaVersion int64                         `json:"schemaVersion"`
	TeamID        string                        `json:"teamId"`
}

type PeerRuntimeBindingHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PeerRuntimeBindingParticipant struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PeerRuntimeChallenge struct {
	Binding       PeerRuntimeChallengeBinding `json:"binding"`
	Nonce         string                      `json:"nonce"`
	Proof         PeerRuntimeChallengeProof   `json:"proof"`
	SchemaVersion int64                       `json:"schemaVersion"`
}

type PeerRuntimeChallengeBinding struct {
	ConnectionID  string               `json:"connectionId"`
	CredentialID  string               `json:"credentialId"`
	Host          MagentaHost          `json:"host"`
	HostOrigin    string               `json:"hostOrigin"`
	MemberID      string               `json:"memberId"`
	MembershipID  string               `json:"membershipId"`
	OperationID   string               `json:"operationId"`
	Participant   TentacledParticipant `json:"participant"`
	PeerID        string               `json:"peerId"`
	SchemaVersion int64                `json:"schemaVersion"`
	TeamID        string               `json:"teamId"`
}

type MagentaHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type TentacledParticipant struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PeerRuntimeChallengeProof struct {
	Payload   Payload11 `json:"payload"`
	Signature string    `json:"signature"`
}

type Payload11 struct {
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

type PeerRuntimeAuthentication struct {
	BindingDigest string                         `json:"bindingDigest"`
	Proof         PeerRuntimeAuthenticationProof `json:"proof"`
	SchemaVersion int64                          `json:"schemaVersion"`
}

type PeerRuntimeAuthenticationProof struct {
	Payload   Payload12 `json:"payload"`
	Signature string    `json:"signature"`
}

type Payload12 struct {
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

type PeerRuntimeReady struct {
	BindingDigest string                `json:"bindingDigest"`
	Proof         PeerRuntimeReadyProof `json:"proof"`
	SchemaVersion int64                 `json:"schemaVersion"`
}

type PeerRuntimeReadyProof struct {
	Payload   Payload13 `json:"payload"`
	Signature string    `json:"signature"`
}

type Payload13 struct {
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

type PeerRuntimeHeartbeat struct {
	BindingDigest string `json:"bindingDigest"`
	SchemaVersion int64  `json:"schemaVersion"`
	Sequence      int64  `json:"sequence"`
}

type PeerRuntimeMessage struct {
	MessageID       string                    `json:"messageId"`
	Payload         PeerRuntimeMessagePayload `json:"payload"`
	ProtocolVersion ProtocolVersion           `json:"protocolVersion"`
	Timestamp       string                    `json:"timestamp"`
	Type            PeerRuntimeMessageType    `json:"type"`
}

type PeerRuntimeMessagePayload struct {
	Binding       *FluffyBinding  `json:"binding,omitempty"`
	Nonce         *string         `json:"nonce,omitempty"`
	Proof         *AmbitiousProof `json:"proof,omitempty"`
	SchemaVersion *int64          `json:"schemaVersion,omitempty"`
	BindingDigest *string         `json:"bindingDigest,omitempty"`
	Sequence      *int64          `json:"sequence,omitempty"`
	Code          *Code           `json:"code,omitempty"`
}

type FluffyBinding struct {
	ConnectionID  string            `json:"connectionId"`
	CredentialID  string            `json:"credentialId"`
	Host          FriskyHost        `json:"host"`
	HostOrigin    string            `json:"hostOrigin"`
	MemberID      string            `json:"memberId"`
	MembershipID  string            `json:"membershipId"`
	OperationID   string            `json:"operationId"`
	Participant   StickyParticipant `json:"participant"`
	PeerID        string            `json:"peerId"`
	SchemaVersion int64             `json:"schemaVersion"`
	TeamID        string            `json:"teamId"`
}

type FriskyHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type StickyParticipant struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type AmbitiousProof struct {
	Payload   Payload14 `json:"payload"`
	Signature string    `json:"signature"`
}

type Payload14 struct {
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

type PeerLeaveIntent struct {
	Host          PeerLeaveIntentHost        `json:"host"`
	HostOrigin    string                     `json:"hostOrigin"`
	MembershipID  string                     `json:"membershipId"`
	OperationID   string                     `json:"operationId"`
	Participant   PeerLeaveIntentParticipant `json:"participant"`
	PeerID        string                     `json:"peerId"`
	SchemaVersion int64                      `json:"schemaVersion"`
}

type PeerLeaveIntentHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PeerLeaveIntentParticipant struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PeerLeaveRequest struct {
	Intent        PeerLeaveRequestIntent `json:"intent"`
	Proof         PeerLeaveRequestProof  `json:"proof"`
	SchemaVersion int64                  `json:"schemaVersion"`
}

type PeerLeaveRequestIntent struct {
	Host          MischievousHost   `json:"host"`
	HostOrigin    string            `json:"hostOrigin"`
	MembershipID  string            `json:"membershipId"`
	OperationID   string            `json:"operationId"`
	Participant   IndigoParticipant `json:"participant"`
	PeerID        string            `json:"peerId"`
	SchemaVersion int64             `json:"schemaVersion"`
}

type MischievousHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type IndigoParticipant struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PeerLeaveRequestProof struct {
	Payload   Payload15 `json:"payload"`
	Signature string    `json:"signature"`
}

type Payload15 struct {
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

type PeerLeaveReceipt struct {
	Intent        PeerLeaveReceiptIntent `json:"intent"`
	Proof         PeerLeaveReceiptProof  `json:"proof"`
	RecordedAt    string                 `json:"recordedAt"`
	SchemaVersion int64                  `json:"schemaVersion"`
	State         PeerLeaveReceiptState  `json:"state"`
}

type PeerLeaveReceiptIntent struct {
	Host          BraggadociousHost   `json:"host"`
	HostOrigin    string              `json:"hostOrigin"`
	MembershipID  string              `json:"membershipId"`
	OperationID   string              `json:"operationId"`
	Participant   IndecentParticipant `json:"participant"`
	PeerID        string              `json:"peerId"`
	SchemaVersion int64               `json:"schemaVersion"`
}

type BraggadociousHost struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type IndecentParticipant struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
}

type PeerLeaveReceiptProof struct {
	Payload   Payload16 `json:"payload"`
	Signature string    `json:"signature"`
}

type Payload16 struct {
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
	NodeIdentity      Purpose = "node.identity"
	PeerConnect       Purpose = "peer.connect"
	PeerLeave         Purpose = "peer.leave"
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

type PeerControlMessageType string

const (
	PeerAgentAcceptance     PeerControlMessageType = "peer.agent.acceptance"
	PeerAgentExport         PeerControlMessageType = "peer.agent.export"
	PeerAgentProjection     PeerControlMessageType = "peer.agent.projection"
	PeerRunAdmission        PeerControlMessageType = "peer.run.admission"
	PeerRunSettlement       PeerControlMessageType = "peer.run.settlement"
	TypePeerChallenge       PeerControlMessageType = "peer.challenge"
	TypePeerError           PeerControlMessageType = "peer.error"
	TypePeerInvitation      PeerControlMessageType = "peer.invitation"
	TypePeerInvitationClaim PeerControlMessageType = "peer.invitation.claim"
	TypePeerMembership      PeerControlMessageType = "peer.membership"
	TypePeerProof           PeerControlMessageType = "peer.proof"
)

type PeerLocalConnectionState string

const (
	Left             PeerLocalConnectionState = "left"
	TentacledActive  PeerLocalConnectionState = "active"
	TentacledRevoked PeerLocalConnectionState = "revoked"
)

type PeerHumanBindingCredentialAudience string

const (
	PeerHumanBinding PeerHumanBindingCredentialAudience = "peer.human-binding"
)

type PeerRuntimeMessageType string

const (
	PeerRuntimeAcknowledged  PeerRuntimeMessageType = "peer.runtime.acknowledged"
	PeerRuntimeAuthenticate  PeerRuntimeMessageType = "peer.runtime.authenticate"
	PeerRuntimeError         PeerRuntimeMessageType = "peer.runtime.error"
	TypePeerRuntimeChallenge PeerRuntimeMessageType = "peer.runtime.challenge"
	TypePeerRuntimeHeartbeat PeerRuntimeMessageType = "peer.runtime.heartbeat"
	TypePeerRuntimeReady     PeerRuntimeMessageType = "peer.runtime.ready"
)

type PeerLeaveReceiptState string

const (
	StickyRevoked PeerLeaveReceiptState = "revoked"
)
