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

