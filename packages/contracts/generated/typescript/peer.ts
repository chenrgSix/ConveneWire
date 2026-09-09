// Code generated from JSON Schema; DO NOT EDIT.

export interface PeerScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export type Kind = "team" | "room";

export interface PeerNodeIdentity {
  nodeId:    string;
  publicKey: string;
}

export interface PeerChallenge {
  challengeId:       string;
  expiresAt:         string;
  hostNodeId:        string;
  nonce:             string;
  participantNodeId: string;
  schemaVersion:     number;
}

export interface PeerProofPayload {
  audienceNodeId:  string;
  expiresAt:       string;
  issuedAt:        string;
  nonce:           string;
  operationId:     string;
  purpose:         Purpose;
  schemaVersion:   number;
  signerNodeId:    string;
  signerPublicKey: string;
  subjectDigest:   string;
}

export type Purpose = "invitation.preview" | "invitation.claim" | "peer.connect" | "human.entry" | "agent.export" | "agent.acceptance" | "run.admission" | "run.settlement";

export interface PeerProof {
  payload:   PeerProofPayloadClass;
  signature: string;
}

export interface PeerProofPayloadClass {
  audienceNodeId:  string;
  expiresAt:       string;
  issuedAt:        string;
  nonce:           string;
  operationId:     string;
  purpose:         Purpose;
  schemaVersion:   number;
  signerNodeId:    string;
  signerPublicKey: string;
  subjectDigest:   string;
}

export interface PeerInvitation {
  expiresAt:           string;
  host:                PeerInvitationHost;
  hostOrigin:          string;
  invitationId:        string;
  membershipExpiresAt: string;
  roomLabel:           null | string;
  schemaVersion:       number;
  scope:               PeerInvitationScope;
  teamLabel:           string;
}

export interface PeerInvitationHost {
  nodeId:    string;
  publicKey: string;
}

export interface PeerInvitationScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface PeerInvitationClaim {
  challengeId:      string;
  displayName:      string;
  invitationDigest: string;
  invitationId:     string;
  localUserId:      string;
  operationId:      string;
  participant:      PeerInvitationClaimParticipant;
  proof:            PeerInvitationClaimProof;
  schemaVersion:    number;
  secret:           string;
}

export interface PeerInvitationClaimParticipant {
  nodeId:    string;
  publicKey: string;
}

export interface PeerInvitationClaimProof {
  payload:   PurplePayload;
  signature: string;
}

export interface PurplePayload {
  audienceNodeId:  string;
  expiresAt:       string;
  issuedAt:        string;
  nonce:           string;
  operationId:     string;
  purpose:         Purpose;
  schemaVersion:   number;
  signerNodeId:    string;
  signerPublicKey: string;
  subjectDigest:   string;
}

export interface PeerMembership {
  createdAt:         string;
  expiresAt:         string;
  hostNodeId:        string;
  localUserId:       string;
  memberId:          string;
  membershipId:      string;
  participantNodeId: string;
  peerId:            string;
  revision:          number;
  schemaVersion:     number;
  scope:             PeerMembershipScope;
  state:             PeerMembershipState;
  userId:            string;
}

export interface PeerMembershipScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export type PeerMembershipState = "active" | "revoked";

export interface PeerMachineCredential {
  audience:      PeerMachineCredentialAudience;
  credentialId:  string;
  expiresAt:     string;
  peerId:        string;
  schemaVersion: number;
  token:         string;
}

export type PeerMachineCredentialAudience = "peer.runtime";

export interface PeerHumanCredential {
  audience:      PeerHumanCredentialAudience;
  credentialId:  string;
  expiresAt:     string;
  membershipId:  string;
  schemaVersion: number;
  scope:         PeerHumanCredentialScope;
  token:         string;
}

export type PeerHumanCredentialAudience = "peer.human";

export interface PeerHumanCredentialScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface PeerCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface AgentExportGrant {
  authorityNodeId:   string;
  capabilities:      AgentExportGrantCapabilities;
  expiresAt:         string;
  exportId:          string;
  issuedAt:          string;
  localAgentId:      string;
  participantNodeId: string;
  peerId:            string;
  revision:          number;
  roomIds:           [string, ...string[]];
  schemaVersion:     number;
  state:             PeerMembershipState;
  teamId:            string;
}

export interface AgentExportGrantCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface RemoteAgentAcceptance {
  acceptanceId:      string;
  authorityNodeId:   string;
  capabilities:      RemoteAgentAcceptanceCapabilities;
  expiresAt:         string;
  exportId:          string;
  grantDigest:       string;
  grantRevision:     number;
  issuedAt:          string;
  memberId:          string;
  participantNodeId: string;
  peerId:            string;
  revision:          number;
  roomIds:           [string, ...string[]];
  schemaVersion:     number;
  state:             PeerMembershipState;
  teamId:            string;
}

export interface RemoteAgentAcceptanceCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface RemoteAgentProjection {
  acceptanceId:       string;
  acceptanceRevision: number;
  authorityNodeId:    string;
  capabilities:       RemoteAgentProjectionCapabilities;
  displayName:        string;
  exportId:           string;
  localAgentId:       string;
  peerId:             string;
  projectionAgentId:  string;
  role:               string;
  schemaVersion:      number;
  teamId:             string;
}

export interface RemoteAgentProjectionCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PeerExecutionBinding {
  acceptanceDigest:   string;
  acceptanceId:       string;
  acceptanceRevision: number;
  authorityNodeId:    string;
  exportId:           string;
  grantDigest:        string;
  grantRevision:      number;
  localAgentId:       string;
  participantNodeId:  string;
  peerId:             string;
  projectionAgentId:  string;
  requestDigest:      string;
  roomId:             string;
  runId:              string;
  schemaVersion:      number;
  teamId:             string;
}

export interface PeerAdmission {
  binding:       PeerAdmissionBinding;
  proof:         PeerAdmissionProof;
  schemaVersion: number;
}

export interface PeerAdmissionBinding {
  acceptanceDigest:   string;
  acceptanceId:       string;
  acceptanceRevision: number;
  authorityNodeId:    string;
  exportId:           string;
  grantDigest:        string;
  grantRevision:      number;
  localAgentId:       string;
  participantNodeId:  string;
  peerId:             string;
  projectionAgentId:  string;
  requestDigest:      string;
  roomId:             string;
  runId:              string;
  schemaVersion:      number;
  teamId:             string;
}

export interface PeerAdmissionProof {
  payload:   FluffyPayload;
  signature: string;
}

export interface FluffyPayload {
  audienceNodeId:  string;
  expiresAt:       string;
  issuedAt:        string;
  nonce:           string;
  operationId:     string;
  purpose:         Purpose;
  schemaVersion:   number;
  signerNodeId:    string;
  signerPublicKey: string;
  subjectDigest:   string;
}

export interface PeerSettlementCapability {
  audience:      PeerSettlementCapabilityAudience;
  binding:       PeerSettlementCapabilityBinding;
  capabilityId:  string;
  expiresAt:     string;
  issuedAt:      string;
  schemaVersion: number;
  token:         string;
}

export type PeerSettlementCapabilityAudience = "peer.settlement";

export interface PeerSettlementCapabilityBinding {
  acceptanceDigest:   string;
  acceptanceId:       string;
  acceptanceRevision: number;
  authorityNodeId:    string;
  exportId:           string;
  grantDigest:        string;
  grantRevision:      number;
  localAgentId:       string;
  participantNodeId:  string;
  peerId:             string;
  projectionAgentId:  string;
  requestDigest:      string;
  roomId:             string;
  runId:              string;
  schemaVersion:      number;
  teamId:             string;
}

export interface PeerSettlement {
  bindingDigest: string;
  capabilityId:  string;
  operationId:   string;
  receiptDigest: string;
  schemaVersion: number;
  sequence:      number;
  state:         PeerSettlementState;
}

export type PeerSettlementState = "completed" | "failed" | "canceled" | "expired" | "outcome_unknown" | "delivery_denied";

export interface PeerError {
  code: Code;
}

export type Code = "UNAUTHENTICATED" | "SCOPE_DENIED" | "EXPIRED" | "REVOKED" | "STALE_AUTHORIZATION" | "PAYLOAD_CONFLICT" | "UNSUPPORTED_VERSION" | "UNSUPPORTED_CAPABILITY" | "INVALID_MESSAGE";

export interface PeerControlMessage {
  messageId:       string;
  payload:         PeerControlMessagePayload;
  protocolVersion: ProtocolVersion;
  timestamp:       string;
  type:            Type;
}

export interface PeerControlMessagePayload {
  challengeId?:         string;
  expiresAt?:           string;
  hostNodeId?:          string;
  nonce?:               string;
  participantNodeId?:   string;
  schemaVersion?:       number;
  payload?:             PayloadPayload;
  signature?:           string;
  host?:                PayloadHost;
  hostOrigin?:          string;
  invitationId?:        string;
  membershipExpiresAt?: string;
  roomLabel?:           null | string;
  scope?:               PayloadScope;
  teamLabel?:           string;
  displayName?:         string;
  invitationDigest?:    string;
  localUserId?:         string;
  operationId?:         string;
  participant?:         PayloadParticipant;
  proof?:               PayloadProof;
  secret?:              string;
  createdAt?:           string;
  memberId?:            string;
  membershipId?:        string;
  peerId?:              string;
  revision?:            number;
  state?:               PayloadState;
  userId?:              string;
  authorityNodeId?:     string;
  capabilities?:        PayloadCapabilities;
  exportId?:            string;
  issuedAt?:            string;
  localAgentId?:        string;
  roomIds?:             [string, ...string[]];
  teamId?:              string;
  acceptanceId?:        string;
  grantDigest?:         string;
  grantRevision?:       number;
  acceptanceRevision?:  number;
  projectionAgentId?:   string;
  role?:                string;
  binding?:             PayloadBinding;
  bindingDigest?:       string;
  capabilityId?:        string;
  receiptDigest?:       string;
  sequence?:            number;
  code?:                Code;
}

export interface PayloadBinding {
  acceptanceDigest:   string;
  acceptanceId:       string;
  acceptanceRevision: number;
  authorityNodeId:    string;
  exportId:           string;
  grantDigest:        string;
  grantRevision:      number;
  localAgentId:       string;
  participantNodeId:  string;
  peerId:             string;
  projectionAgentId:  string;
  requestDigest:      string;
  roomId:             string;
  runId:              string;
  schemaVersion:      number;
  teamId:             string;
}

export interface PayloadCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PayloadHost {
  nodeId:    string;
  publicKey: string;
}

export interface PayloadParticipant {
  nodeId:    string;
  publicKey: string;
}

export interface PayloadPayload {
  audienceNodeId:  string;
  expiresAt:       string;
  issuedAt:        string;
  nonce:           string;
  operationId:     string;
  purpose:         Purpose;
  schemaVersion:   number;
  signerNodeId:    string;
  signerPublicKey: string;
  subjectDigest:   string;
}

export interface PayloadProof {
  payload:   TentacledPayload;
  signature: string;
}

export interface TentacledPayload {
  audienceNodeId:  string;
  expiresAt:       string;
  issuedAt:        string;
  nonce:           string;
  operationId:     string;
  purpose:         Purpose;
  schemaVersion:   number;
  signerNodeId:    string;
  signerPublicKey: string;
  subjectDigest:   string;
}

export interface PayloadScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export type PayloadState = "active" | "revoked" | "completed" | "failed" | "canceled" | "expired" | "outcome_unknown" | "delivery_denied";

export type ProtocolVersion = "peer.v1";

export type Type = "peer.challenge" | "peer.proof" | "peer.invitation" | "peer.invitation.claim" | "peer.membership" | "peer.agent.export" | "peer.agent.acceptance" | "peer.agent.projection" | "peer.run.admission" | "peer.run.settlement" | "peer.error";

export interface PeerJoinReceipt {
  invitation:        PeerJoinReceiptInvitation;
  machineCredential: PeerJoinReceiptMachineCredential;
  membership:        PeerJoinReceiptMembership;
  proof:             PeerJoinReceiptProof;
  schemaVersion:     number;
}

export interface PeerJoinReceiptInvitation {
  expiresAt:           string;
  host:                PurpleHost;
  hostOrigin:          string;
  invitationId:        string;
  membershipExpiresAt: string;
  roomLabel:           null | string;
  schemaVersion:       number;
  scope:               PurpleScope;
  teamLabel:           string;
}

export interface PurpleHost {
  nodeId:    string;
  publicKey: string;
}

export interface PurpleScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface PeerJoinReceiptMachineCredential {
  audience:      PeerMachineCredentialAudience;
  credentialId:  string;
  expiresAt:     string;
  peerId:        string;
  schemaVersion: number;
  token:         string;
}

export interface PeerJoinReceiptMembership {
  createdAt:         string;
  expiresAt:         string;
  hostNodeId:        string;
  localUserId:       string;
  memberId:          string;
  membershipId:      string;
  participantNodeId: string;
  peerId:            string;
  revision:          number;
  schemaVersion:     number;
  scope:             FluffyScope;
  state:             PeerMembershipState;
  userId:            string;
}

export interface FluffyScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface PeerJoinReceiptProof {
  payload:   StickyPayload;
  signature: string;
}

export interface StickyPayload {
  audienceNodeId:  string;
  expiresAt:       string;
  issuedAt:        string;
  nonce:           string;
  operationId:     string;
  purpose:         Purpose;
  schemaVersion:   number;
  signerNodeId:    string;
  signerPublicKey: string;
  subjectDigest:   string;
}

export interface PeerLocalConnection {
  acceptances: PeerLocalConnectionAcceptance[];
  exports:     PeerLocalConnectionExport[];
  receipt:     PeerLocalConnectionReceipt;
  state:       PeerLocalConnectionState;
}

export interface PeerLocalConnectionAcceptance {
  acceptanceId:      string;
  authorityNodeId:   string;
  capabilities:      PurpleCapabilities;
  expiresAt:         string;
  exportId:          string;
  grantDigest:       string;
  grantRevision:     number;
  issuedAt:          string;
  memberId:          string;
  participantNodeId: string;
  peerId:            string;
  revision:          number;
  roomIds:           [string, ...string[]];
  schemaVersion:     number;
  state:             PeerMembershipState;
  teamId:            string;
}

export interface PurpleCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PeerLocalConnectionExport {
  authorityNodeId:   string;
  capabilities:      FluffyCapabilities;
  expiresAt:         string;
  exportId:          string;
  issuedAt:          string;
  localAgentId:      string;
  participantNodeId: string;
  peerId:            string;
  revision:          number;
  roomIds:           [string, ...string[]];
  schemaVersion:     number;
  state:             PeerMembershipState;
  teamId:            string;
}

export interface FluffyCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PeerLocalConnectionReceipt {
  invitation:        PurpleInvitation;
  machineCredential: PurpleMachineCredential;
  membership:        PurpleMembership;
  proof:             PurpleProof;
  schemaVersion:     number;
}

export interface PurpleInvitation {
  expiresAt:           string;
  host:                FluffyHost;
  hostOrigin:          string;
  invitationId:        string;
  membershipExpiresAt: string;
  roomLabel:           null | string;
  schemaVersion:       number;
  scope:               TentacledScope;
  teamLabel:           string;
}

export interface FluffyHost {
  nodeId:    string;
  publicKey: string;
}

export interface TentacledScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface PurpleMachineCredential {
  audience:      PeerMachineCredentialAudience;
  credentialId:  string;
  expiresAt:     string;
  peerId:        string;
  schemaVersion: number;
  token:         string;
}

export interface PurpleMembership {
  createdAt:         string;
  expiresAt:         string;
  hostNodeId:        string;
  localUserId:       string;
  memberId:          string;
  membershipId:      string;
  participantNodeId: string;
  peerId:            string;
  revision:          number;
  schemaVersion:     number;
  scope:             StickyScope;
  state:             PeerMembershipState;
  userId:            string;
}

export interface StickyScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface PurpleProof {
  payload:   IndigoPayload;
  signature: string;
}

export interface IndigoPayload {
  audienceNodeId:  string;
  expiresAt:       string;
  issuedAt:        string;
  nonce:           string;
  operationId:     string;
  purpose:         Purpose;
  schemaVersion:   number;
  signerNodeId:    string;
  signerPublicKey: string;
  subjectDigest:   string;
}

export type PeerLocalConnectionState = "active" | "left" | "revoked";

export interface PeerParticipantState {
  connections:   Connection[];
  localUserId:   string;
  participant:   PeerParticipantStateParticipant;
  revision:      number;
  schemaVersion: number;
}

export interface Connection {
  acceptances: ConnectionAcceptance[];
  exports:     ConnectionExport[];
  receipt:     ConnectionReceipt;
  state:       PeerLocalConnectionState;
}

export interface ConnectionAcceptance {
  acceptanceId:      string;
  authorityNodeId:   string;
  capabilities:      TentacledCapabilities;
  expiresAt:         string;
  exportId:          string;
  grantDigest:       string;
  grantRevision:     number;
  issuedAt:          string;
  memberId:          string;
  participantNodeId: string;
  peerId:            string;
  revision:          number;
  roomIds:           [string, ...string[]];
  schemaVersion:     number;
  state:             PeerMembershipState;
  teamId:            string;
}

export interface TentacledCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface ConnectionExport {
  authorityNodeId:   string;
  capabilities:      StickyCapabilities;
  expiresAt:         string;
  exportId:          string;
  issuedAt:          string;
  localAgentId:      string;
  participantNodeId: string;
  peerId:            string;
  revision:          number;
  roomIds:           [string, ...string[]];
  schemaVersion:     number;
  state:             PeerMembershipState;
  teamId:            string;
}

export interface StickyCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface ConnectionReceipt {
  invitation:        FluffyInvitation;
  machineCredential: FluffyMachineCredential;
  membership:        FluffyMembership;
  proof:             FluffyProof;
  schemaVersion:     number;
}

export interface FluffyInvitation {
  expiresAt:           string;
  host:                TentacledHost;
  hostOrigin:          string;
  invitationId:        string;
  membershipExpiresAt: string;
  roomLabel:           null | string;
  schemaVersion:       number;
  scope:               IndigoScope;
  teamLabel:           string;
}

export interface TentacledHost {
  nodeId:    string;
  publicKey: string;
}

export interface IndigoScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface FluffyMachineCredential {
  audience:      PeerMachineCredentialAudience;
  credentialId:  string;
  expiresAt:     string;
  peerId:        string;
  schemaVersion: number;
  token:         string;
}

export interface FluffyMembership {
  createdAt:         string;
  expiresAt:         string;
  hostNodeId:        string;
  localUserId:       string;
  memberId:          string;
  membershipId:      string;
  participantNodeId: string;
  peerId:            string;
  revision:          number;
  schemaVersion:     number;
  scope:             IndecentScope;
  state:             PeerMembershipState;
  userId:            string;
}

export interface IndecentScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface FluffyProof {
  payload:   IndecentPayload;
  signature: string;
}

export interface IndecentPayload {
  audienceNodeId:  string;
  expiresAt:       string;
  issuedAt:        string;
  nonce:           string;
  operationId:     string;
  purpose:         Purpose;
  schemaVersion:   number;
  signerNodeId:    string;
  signerPublicKey: string;
  subjectDigest:   string;
}

export interface PeerParticipantStateParticipant {
  nodeId:    string;
  publicKey: string;
}

export interface PeerInvitationCreateRequest {
  expiresAt:           string;
  membershipExpiresAt: string;
  operationId:         string;
  schemaVersion:       number;
  scope:               PeerInvitationCreateRequestScope;
}

export interface PeerInvitationCreateRequestScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface PeerInvitationIssued {
  invitation:    PeerInvitationIssuedInvitation;
  schemaVersion: number;
  secret:        string;
}

export interface PeerInvitationIssuedInvitation {
  expiresAt:           string;
  host:                StickyHost;
  hostOrigin:          string;
  invitationId:        string;
  membershipExpiresAt: string;
  roomLabel:           null | string;
  schemaVersion:       number;
  scope:               HilariousScope;
  teamLabel:           string;
}

export interface StickyHost {
  nodeId:    string;
  publicKey: string;
}

export interface HilariousScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface PeerInvitationPreviewRequest {
  invitationId:  string;
  nonce:         string;
  operationId:   string;
  participant:   PeerInvitationPreviewRequestParticipant;
  schemaVersion: number;
  secret:        string;
}

export interface PeerInvitationPreviewRequestParticipant {
  nodeId:    string;
  publicKey: string;
}

export interface PeerInvitationPreview {
  invitation:    PeerInvitationPreviewInvitation;
  proof:         PeerInvitationPreviewProof;
  schemaVersion: number;
}

export interface PeerInvitationPreviewInvitation {
  expiresAt:           string;
  host:                IndigoHost;
  hostOrigin:          string;
  invitationId:        string;
  membershipExpiresAt: string;
  roomLabel:           null | string;
  schemaVersion:       number;
  scope:               AmbitiousScope;
  teamLabel:           string;
}

export interface IndigoHost {
  nodeId:    string;
  publicKey: string;
}

export interface AmbitiousScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface PeerInvitationPreviewProof {
  payload:   HilariousPayload;
  signature: string;
}

export interface HilariousPayload {
  audienceNodeId:  string;
  expiresAt:       string;
  issuedAt:        string;
  nonce:           string;
  operationId:     string;
  purpose:         Purpose;
  schemaVersion:   number;
  signerNodeId:    string;
  signerPublicKey: string;
  subjectDigest:   string;
}

export interface PeerClaimChallengeRequest {
  invitationId:  string;
  operationId:   string;
  participant:   PeerClaimChallengeRequestParticipant;
  schemaVersion: number;
  secret:        string;
  subjectDigest: string;
}

export interface PeerClaimChallengeRequestParticipant {
  nodeId:    string;
  publicKey: string;
}

export interface PeerHumanBindingCredential {
  audience:      PeerHumanBindingCredentialAudience;
  credentialId:  string;
  expiresAt:     string;
  membershipId:  string;
  schemaVersion: number;
  scope:         PeerHumanBindingCredentialScope;
  token:         string;
}

export type PeerHumanBindingCredentialAudience = "peer.human-binding";

export interface PeerHumanBindingCredentialScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface PeerHumanBindingReceipt {
  host:              PeerHumanBindingReceiptHost;
  humanCredential:   PeerHumanBindingReceiptHumanCredential;
  joinReceiptDigest: string;
  localUserId:       string;
  participant:       PeerHumanBindingReceiptParticipant;
  proof:             PeerHumanBindingReceiptProof;
  schemaVersion:     number;
}

export interface PeerHumanBindingReceiptHost {
  nodeId:    string;
  publicKey: string;
}

export interface PeerHumanBindingReceiptHumanCredential {
  audience:      PeerHumanBindingCredentialAudience;
  credentialId:  string;
  expiresAt:     string;
  membershipId:  string;
  schemaVersion: number;
  scope:         CunningScope;
  token:         string;
}

export interface CunningScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface PeerHumanBindingReceiptParticipant {
  nodeId:    string;
  publicKey: string;
}

export interface PeerHumanBindingReceiptProof {
  payload:   AmbitiousPayload;
  signature: string;
}

export interface AmbitiousPayload {
  audienceNodeId:  string;
  expiresAt:       string;
  issuedAt:        string;
  nonce:           string;
  operationId:     string;
  purpose:         Purpose;
  schemaVersion:   number;
  signerNodeId:    string;
  signerPublicKey: string;
  subjectDigest:   string;
}

export interface PeerJoined {
  human:         Human;
  runtime:       Runtime;
  schemaVersion: number;
}

export interface Human {
  host:              HumanHost;
  humanCredential:   HumanHumanCredential;
  joinReceiptDigest: string;
  localUserId:       string;
  participant:       HumanParticipant;
  proof:             HumanProof;
  schemaVersion:     number;
}

export interface HumanHost {
  nodeId:    string;
  publicKey: string;
}

export interface HumanHumanCredential {
  audience:      PeerHumanBindingCredentialAudience;
  credentialId:  string;
  expiresAt:     string;
  membershipId:  string;
  schemaVersion: number;
  scope:         MagentaScope;
  token:         string;
}

export interface MagentaScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface HumanParticipant {
  nodeId:    string;
  publicKey: string;
}

export interface HumanProof {
  payload:   CunningPayload;
  signature: string;
}

export interface CunningPayload {
  audienceNodeId:  string;
  expiresAt:       string;
  issuedAt:        string;
  nonce:           string;
  operationId:     string;
  purpose:         Purpose;
  schemaVersion:   number;
  signerNodeId:    string;
  signerPublicKey: string;
  subjectDigest:   string;
}

export interface Runtime {
  invitation:        RuntimeInvitation;
  machineCredential: RuntimeMachineCredential;
  membership:        RuntimeMembership;
  proof:             RuntimeProof;
  schemaVersion:     number;
}

export interface RuntimeInvitation {
  expiresAt:           string;
  host:                IndecentHost;
  hostOrigin:          string;
  invitationId:        string;
  membershipExpiresAt: string;
  roomLabel:           null | string;
  schemaVersion:       number;
  scope:               FriskyScope;
  teamLabel:           string;
}

export interface IndecentHost {
  nodeId:    string;
  publicKey: string;
}

export interface FriskyScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface RuntimeMachineCredential {
  audience:      PeerMachineCredentialAudience;
  credentialId:  string;
  expiresAt:     string;
  peerId:        string;
  schemaVersion: number;
  token:         string;
}

export interface RuntimeMembership {
  createdAt:         string;
  expiresAt:         string;
  hostNodeId:        string;
  localUserId:       string;
  memberId:          string;
  membershipId:      string;
  participantNodeId: string;
  peerId:            string;
  revision:          number;
  schemaVersion:     number;
  scope:             MischievousScope;
  state:             PeerMembershipState;
  userId:            string;
}

export interface MischievousScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface RuntimeProof {
  payload:   MagentaPayload;
  signature: string;
}

export interface MagentaPayload {
  audienceNodeId:  string;
  expiresAt:       string;
  issuedAt:        string;
  nonce:           string;
  operationId:     string;
  purpose:         Purpose;
  schemaVersion:   number;
  signerNodeId:    string;
  signerPublicKey: string;
  subjectDigest:   string;
}

