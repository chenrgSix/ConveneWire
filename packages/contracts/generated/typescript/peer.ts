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

export type Purpose = "invitation.preview" | "invitation.claim" | "peer.connect" | "human.entry" | "agent.export" | "agent.acceptance" | "run.admission" | "run.settlement" | "node.identity";

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
  messageId?:                  string;
  payload?:                    PeerControlMessagePayload;
  protocolVersion?:            ProtocolVersion;
  timestamp?:                  string;
  type?:                       Type;
  displayName?:                string;
  grant?:                      PeerControlMessageGrant;
  role?:                       string;
  schemaVersion?:              number;
  offer?:                      PurpleOffer;
  proof?:                      PeerControlMessageProof;
  exportId?:                   string;
  grantDigest?:                string;
  grantRevision?:              number;
  offerDigest?:                string;
  capabilities?:               PeerControlMessageCapabilities;
  expectedAcceptanceId?:       null | string;
  expectedAcceptanceRevision?: number | null;
  expiresAt?:                  string;
  localAgentId?:               string;
  operationId?:                string;
  peerId?:                     string;
  roomIds?:                    [string, ...string[]];
  acceptanceId?:               string;
  expectedRevision?:           number;
  acceptance?:                 PeerControlMessageAcceptance;
  projection?:                 PeerControlMessageProjection;
  configurationDigest?:        string;
  intentDigest?:               string;
  offers?:                     [FluffyOffer, ...FluffyOffer[]];
  acceptanceHistory?:          PeerControlMessageAcceptanceHistory[];
  exportHistoryLength?:        number;
  historyDigest?:              string;
}

export interface PeerControlMessageAcceptance {
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

export interface PeerControlMessageAcceptanceHistory {
  acceptance:    PurpleAcceptance;
  offerDigest:   string;
  projection:    PurpleProjection;
  schemaVersion: number;
  sequence:      number;
}

export interface PurpleAcceptance {
  acceptanceId:      string;
  authorityNodeId:   string;
  capabilities:      FluffyCapabilities;
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

export interface FluffyCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PurpleProjection {
  acceptanceId:       string;
  acceptanceRevision: number;
  authorityNodeId:    string;
  capabilities:       TentacledCapabilities;
  displayName:        string;
  exportId:           string;
  localAgentId:       string;
  peerId:             string;
  projectionAgentId:  string;
  role:               string;
  schemaVersion:      number;
  teamId:             string;
}

export interface TentacledCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PeerControlMessageCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PeerControlMessageGrant {
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

export interface PurpleOffer {
  displayName:   string;
  grant:         PurpleGrant;
  role:          string;
  schemaVersion: number;
}

export interface PurpleGrant {
  authorityNodeId:   string;
  capabilities:      IndigoCapabilities;
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

export interface IndigoCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface FluffyOffer {
  displayName:   string;
  grant:         FluffyGrant;
  role:          string;
  schemaVersion: number;
}

export interface FluffyGrant {
  authorityNodeId:   string;
  capabilities:      IndecentCapabilities;
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

export interface IndecentCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
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

export interface PeerControlMessageProjection {
  acceptanceId:       string;
  acceptanceRevision: number;
  authorityNodeId:    string;
  capabilities:       HilariousCapabilities;
  displayName:        string;
  exportId:           string;
  localAgentId:       string;
  peerId:             string;
  projectionAgentId:  string;
  role:               string;
  schemaVersion:      number;
  teamId:             string;
}

export interface HilariousCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PeerControlMessageProof {
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

export interface PeerLocalConnection {
  acceptances:          PeerLocalConnectionAcceptance[];
  acceptanceSnapshots?: PeerLocalConnectionAcceptanceSnapshot[];
  exports:              PeerLocalConnectionExport[];
  localExports?:        PeerLocalConnectionLocalExport[];
  receipt:              PeerLocalConnectionReceipt;
  state:                PeerLocalConnectionState;
}

export interface PeerLocalConnectionAcceptanceSnapshot {
  acceptanceHistory:   PurpleAcceptanceHistory[];
  exportHistoryLength: number;
  exportId:            string;
  grantDigest:         string;
  grantRevision:       number;
  historyDigest:       string;
  localAgentId:        string;
  peerId:              string;
  proof:               PurpleProof;
  schemaVersion:       number;
}

export interface PurpleAcceptanceHistory {
  acceptance:    FluffyAcceptance;
  offerDigest:   string;
  projection:    FluffyProjection;
  schemaVersion: number;
  sequence:      number;
}

export interface FluffyAcceptance {
  acceptanceId:      string;
  authorityNodeId:   string;
  capabilities:      AmbitiousCapabilities;
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

export interface AmbitiousCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface FluffyProjection {
  acceptanceId:       string;
  acceptanceRevision: number;
  authorityNodeId:    string;
  capabilities:       CunningCapabilities;
  displayName:        string;
  exportId:           string;
  localAgentId:       string;
  peerId:             string;
  projectionAgentId:  string;
  role:               string;
  schemaVersion:      number;
  teamId:             string;
}

export interface CunningCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PurpleProof {
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

export interface PeerLocalConnectionAcceptance {
  acceptanceId:      string;
  authorityNodeId:   string;
  capabilities:      MagentaCapabilities;
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

export interface MagentaCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PeerLocalConnectionExport {
  authorityNodeId:   string;
  capabilities:      FriskyCapabilities;
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

export interface FriskyCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PeerLocalConnectionLocalExport {
  configurationDigest: string;
  intentDigest:        string;
  offer:               TentacledOffer;
  operationId:         string;
  schemaVersion:       number;
}

export interface TentacledOffer {
  displayName:   string;
  grant:         TentacledGrant;
  role:          string;
  schemaVersion: number;
}

export interface TentacledGrant {
  authorityNodeId:   string;
  capabilities:      MischievousCapabilities;
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

export interface MischievousCapabilities {
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
  proof:             FluffyProof;
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

export interface FluffyProof {
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

export type PeerLocalConnectionState = "active" | "left" | "revoked";

export interface PeerParticipantState {
  connections:   Connection[];
  localUserId:   string;
  participant:   PeerParticipantStateParticipant;
  revision:      number;
  schemaVersion: number;
}

export interface Connection {
  acceptances:          ConnectionAcceptance[];
  acceptanceSnapshots?: ConnectionAcceptanceSnapshot[];
  exports:              ConnectionExport[];
  localExports?:        ConnectionLocalExport[];
  receipt:              ConnectionReceipt;
  state:                PeerLocalConnectionState;
}

export interface ConnectionAcceptanceSnapshot {
  acceptanceHistory:   FluffyAcceptanceHistory[];
  exportHistoryLength: number;
  exportId:            string;
  grantDigest:         string;
  grantRevision:       number;
  historyDigest:       string;
  localAgentId:        string;
  peerId:              string;
  proof:               TentacledProof;
  schemaVersion:       number;
}

export interface FluffyAcceptanceHistory {
  acceptance:    TentacledAcceptance;
  offerDigest:   string;
  projection:    TentacledProjection;
  schemaVersion: number;
  sequence:      number;
}

export interface TentacledAcceptance {
  acceptanceId:      string;
  authorityNodeId:   string;
  capabilities:      BraggadociousCapabilities;
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

export interface BraggadociousCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface TentacledProjection {
  acceptanceId:       string;
  acceptanceRevision: number;
  authorityNodeId:    string;
  capabilities:       Capabilities1;
  displayName:        string;
  exportId:           string;
  localAgentId:       string;
  peerId:             string;
  projectionAgentId:  string;
  role:               string;
  schemaVersion:      number;
  teamId:             string;
}

export interface Capabilities1 {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface TentacledProof {
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

export interface ConnectionAcceptance {
  acceptanceId:      string;
  authorityNodeId:   string;
  capabilities:      Capabilities2;
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

export interface Capabilities2 {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface ConnectionExport {
  authorityNodeId:   string;
  capabilities:      Capabilities3;
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

export interface Capabilities3 {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface ConnectionLocalExport {
  configurationDigest: string;
  intentDigest:        string;
  offer:               StickyOffer;
  operationId:         string;
  schemaVersion:       number;
}

export interface StickyOffer {
  displayName:   string;
  grant:         StickyGrant;
  role:          string;
  schemaVersion: number;
}

export interface StickyGrant {
  authorityNodeId:   string;
  capabilities:      Capabilities4;
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

export interface Capabilities4 {
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
  proof:             StickyProof;
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

export interface StickyProof {
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
  payload:   FriskyPayload;
  signature: string;
}

export interface FriskyPayload {
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
  payload:   MischievousPayload;
  signature: string;
}

export interface MischievousPayload {
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
  payload:   BraggadociousPayload;
  signature: string;
}

export interface BraggadociousPayload {
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

export interface PeerHumanEntryRequest {
  bindingCredentialId: string;
  bindingToken:        string;
  nonce:               string;
  operationId:         string;
  proof:               PeerHumanEntryRequestProof;
  schemaVersion:       number;
  scope:               PeerHumanEntryRequestScope;
}

export interface PeerHumanEntryRequestProof {
  payload:   Payload1;
  signature: string;
}

export interface Payload1 {
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

export interface PeerHumanEntryRequestScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface PeerHumanEntry {
  credential:        Credential;
  exchangeExpiresAt: string;
  hostOrigin:        string;
  proof:             PeerHumanEntryProof;
  schemaVersion:     number;
}

export interface Credential {
  audience:      PeerHumanCredentialAudience;
  credentialId:  string;
  expiresAt:     string;
  membershipId:  string;
  schemaVersion: number;
  scope:         CredentialScope;
  token:         string;
}

export interface CredentialScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface PeerHumanEntryProof {
  payload:   Payload2;
  signature: string;
}

export interface Payload2 {
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

export interface PeerBrowserEntryRequest {
  credentialId:  string;
  schemaVersion: number;
  token:         string;
}

export interface PeerHumanEntryIdentity {
  displayName:   string;
  memberId:      string;
  membershipId:  string;
  roomLabel:     null | string;
  schemaVersion: number;
  scope:         PeerHumanEntryIdentityScope;
  teamLabel:     string;
  userId:        string;
}

export interface PeerHumanEntryIdentityScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface PeerIdentityRequest {
  nonce:         string;
  operationId:   string;
  participant:   PeerIdentityRequestParticipant;
  schemaVersion: number;
}

export interface PeerIdentityRequestParticipant {
  nodeId:    string;
  publicKey: string;
}

export interface PeerIdentityProof {
  host:          PeerIdentityProofHost;
  hostOrigin:    string;
  proof:         PeerIdentityProofProof;
  schemaVersion: number;
}

export interface PeerIdentityProofHost {
  nodeId:    string;
  publicKey: string;
}

export interface PeerIdentityProofProof {
  payload:   Payload3;
  signature: string;
}

export interface Payload3 {
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

export interface PeerLocalHumanBinding {
  receipt: PeerLocalHumanBindingReceipt;
  state:   PeerMembershipState;
}

export interface PeerLocalHumanBindingReceipt {
  host:              HilariousHost;
  humanCredential:   PurpleHumanCredential;
  joinReceiptDigest: string;
  localUserId:       string;
  participant:       PurpleParticipant;
  proof:             IndigoProof;
  schemaVersion:     number;
}

export interface HilariousHost {
  nodeId:    string;
  publicKey: string;
}

export interface PurpleHumanCredential {
  audience:      PeerHumanBindingCredentialAudience;
  credentialId:  string;
  expiresAt:     string;
  membershipId:  string;
  schemaVersion: number;
  scope:         BraggadociousScope;
  token:         string;
}

export interface BraggadociousScope {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface PurpleParticipant {
  nodeId:    string;
  publicKey: string;
}

export interface IndigoProof {
  payload:   Payload4;
  signature: string;
}

export interface Payload4 {
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

export interface PeerHumanVaultState {
  bindings:      BindingElement[];
  localUserId:   string;
  participant:   PeerHumanVaultStateParticipant;
  revision:      number;
  schemaVersion: number;
}

export interface BindingElement {
  receipt: BindingReceipt;
  state:   PeerMembershipState;
}

export interface BindingReceipt {
  host:              AmbitiousHost;
  humanCredential:   FluffyHumanCredential;
  joinReceiptDigest: string;
  localUserId:       string;
  participant:       FluffyParticipant;
  proof:             IndecentProof;
  schemaVersion:     number;
}

export interface AmbitiousHost {
  nodeId:    string;
  publicKey: string;
}

export interface FluffyHumanCredential {
  audience:      PeerHumanBindingCredentialAudience;
  credentialId:  string;
  expiresAt:     string;
  membershipId:  string;
  schemaVersion: number;
  scope:         Scope1;
  token:         string;
}

export interface Scope1 {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface FluffyParticipant {
  nodeId:    string;
  publicKey: string;
}

export interface IndecentProof {
  payload:   Payload5;
  signature: string;
}

export interface Payload5 {
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

export interface PeerHumanVaultStateParticipant {
  nodeId:    string;
  publicKey: string;
}

export interface PeerPendingJoin {
  createdAt:     string;
  displayName:   string;
  invitation:    PeerPendingJoinInvitation;
  localUserId:   string;
  operationId:   string;
  participant:   PeerPendingJoinParticipant;
  previewProof:  PreviewProof;
  schemaVersion: number;
  secret:        string;
}

export interface PeerPendingJoinInvitation {
  expiresAt:           string;
  host:                CunningHost;
  hostOrigin:          string;
  invitationId:        string;
  membershipExpiresAt: string;
  roomLabel:           null | string;
  schemaVersion:       number;
  scope:               Scope2;
  teamLabel:           string;
}

export interface CunningHost {
  nodeId:    string;
  publicKey: string;
}

export interface Scope2 {
  kind:   Kind;
  roomId: null | string;
  teamId: string;
}

export interface PeerPendingJoinParticipant {
  nodeId:    string;
  publicKey: string;
}

export interface PreviewProof {
  payload:   PreviewProofPayload;
  signature: string;
}

export interface PreviewProofPayload {
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

export interface PeerAgentOffer {
  displayName:   string;
  grant:         PeerAgentOfferGrant;
  role:          string;
  schemaVersion: number;
}

export interface PeerAgentOfferGrant {
  authorityNodeId:   string;
  capabilities:      Capabilities5;
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

export interface Capabilities5 {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PeerAgentOfferRequest {
  offer:         PeerAgentOfferRequestOffer;
  proof:         PeerAgentOfferRequestProof;
  schemaVersion: number;
}

export interface PeerAgentOfferRequestOffer {
  displayName:   string;
  grant:         IndigoGrant;
  role:          string;
  schemaVersion: number;
}

export interface IndigoGrant {
  authorityNodeId:   string;
  capabilities:      Capabilities6;
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

export interface Capabilities6 {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PeerAgentOfferRequestProof {
  payload:   Payload6;
  signature: string;
}

export interface Payload6 {
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

export interface PeerAgentOfferReceipt {
  exportId:      string;
  grantDigest:   string;
  grantRevision: number;
  offerDigest:   string;
  proof:         PeerAgentOfferReceiptProof;
  schemaVersion: number;
}

export interface PeerAgentOfferReceiptProof {
  payload:   Payload7;
  signature: string;
}

export interface Payload7 {
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

export interface PeerAgentAcceptanceRequest {
  capabilities:               PeerAgentAcceptanceRequestCapabilities;
  expectedAcceptanceId:       null | string;
  expectedAcceptanceRevision: number | null;
  expiresAt:                  string;
  exportId:                   string;
  grantDigest:                string;
  grantRevision:              number;
  localAgentId:               string;
  offerDigest:                string;
  operationId:                string;
  peerId:                     string;
  roomIds:                    [string, ...string[]];
  schemaVersion:              number;
}

export interface PeerAgentAcceptanceRequestCapabilities {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PeerAgentRevokeRequest {
  acceptanceId:     string;
  expectedRevision: number;
  operationId:      string;
  schemaVersion:    number;
}

export interface PeerAgentAcceptanceReceipt {
  acceptance:    PeerAgentAcceptanceReceiptAcceptance;
  offerDigest:   string;
  projection:    PeerAgentAcceptanceReceiptProjection;
  proof:         PeerAgentAcceptanceReceiptProof;
  schemaVersion: number;
}

export interface PeerAgentAcceptanceReceiptAcceptance {
  acceptanceId:      string;
  authorityNodeId:   string;
  capabilities:      Capabilities7;
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

export interface Capabilities7 {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PeerAgentAcceptanceReceiptProjection {
  acceptanceId:       string;
  acceptanceRevision: number;
  authorityNodeId:    string;
  capabilities:       Capabilities8;
  displayName:        string;
  exportId:           string;
  localAgentId:       string;
  peerId:             string;
  projectionAgentId:  string;
  role:               string;
  schemaVersion:      number;
  teamId:             string;
}

export interface Capabilities8 {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PeerAgentAcceptanceReceiptProof {
  payload:   Payload8;
  signature: string;
}

export interface Payload8 {
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

export interface PeerLocalExport {
  configurationDigest: string;
  intentDigest:        string;
  offer:               PeerLocalExportOffer;
  operationId:         string;
  schemaVersion:       number;
}

export interface PeerLocalExportOffer {
  displayName:   string;
  grant:         IndecentGrant;
  role:          string;
  schemaVersion: number;
}

export interface IndecentGrant {
  authorityNodeId:   string;
  capabilities:      Capabilities9;
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

export interface Capabilities9 {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PeerAgentSyncRequest {
  localAgentId:  string;
  offers:        [PeerAgentSyncRequestOffer, ...PeerAgentSyncRequestOffer[]];
  proof:         PeerAgentSyncRequestProof;
  schemaVersion: number;
}

export interface PeerAgentSyncRequestOffer {
  displayName:   string;
  grant:         HilariousGrant;
  role:          string;
  schemaVersion: number;
}

export interface HilariousGrant {
  authorityNodeId:   string;
  capabilities:      Capabilities10;
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

export interface Capabilities10 {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PeerAgentSyncRequestProof {
  payload:   Payload9;
  signature: string;
}

export interface Payload9 {
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

export interface PeerAgentSyncReceipt {
  acceptanceHistory:   PeerAgentSyncReceiptAcceptanceHistory[];
  exportHistoryLength: number;
  exportId:            string;
  grantDigest:         string;
  grantRevision:       number;
  historyDigest:       string;
  localAgentId:        string;
  peerId:              string;
  proof:               PeerAgentSyncReceiptProof;
  schemaVersion:       number;
}

export interface PeerAgentSyncReceiptAcceptanceHistory {
  acceptance:    StickyAcceptance;
  offerDigest:   string;
  projection:    StickyProjection;
  schemaVersion: number;
  sequence:      number;
}

export interface StickyAcceptance {
  acceptanceId:      string;
  authorityNodeId:   string;
  capabilities:      Capabilities11;
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

export interface Capabilities11 {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface StickyProjection {
  acceptanceId:       string;
  acceptanceRevision: number;
  authorityNodeId:    string;
  capabilities:       Capabilities12;
  displayName:        string;
  exportId:           string;
  localAgentId:       string;
  peerId:             string;
  projectionAgentId:  string;
  role:               string;
  schemaVersion:      number;
  teamId:             string;
}

export interface Capabilities12 {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PeerAgentSyncReceiptProof {
  payload:   Payload10;
  signature: string;
}

export interface Payload10 {
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

export interface PeerAgentAcceptanceRecord {
  acceptance:    PeerAgentAcceptanceRecordAcceptance;
  offerDigest:   string;
  projection:    PeerAgentAcceptanceRecordProjection;
  schemaVersion: number;
  sequence:      number;
}

export interface PeerAgentAcceptanceRecordAcceptance {
  acceptanceId:      string;
  authorityNodeId:   string;
  capabilities:      Capabilities13;
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

export interface Capabilities13 {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PeerAgentAcceptanceRecordProjection {
  acceptanceId:       string;
  acceptanceRevision: number;
  authorityNodeId:    string;
  capabilities:       Capabilities14;
  displayName:        string;
  exportId:           string;
  localAgentId:       string;
  peerId:             string;
  projectionAgentId:  string;
  role:               string;
  schemaVersion:      number;
  teamId:             string;
}

export interface Capabilities14 {
  supportsInterrupt:            boolean;
  supportsOwnerPrivateOutput:   boolean;
  supportsResume:               boolean;
  supportsStart:                boolean;
  supportsStreaming:            boolean;
  supportsTaskContextIsolation: boolean;
}

export interface PeerIngressConfiguration {
  certificateFile: string;
  enabled:         boolean;
  listenHost:      string;
  origin:          string;
  privateKeyFile:  string;
  schemaVersion:   number;
}

