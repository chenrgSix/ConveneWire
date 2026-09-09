// Code generated from JSON Schema; DO NOT EDIT.

export interface AuthorityRef {
  authorityNodeId: string;
  objectId:        string;
  objectType:      ObjectType;
}

export type ObjectType = "team" | "room" | "message" | "task" | "run" | "discussion" | "wave" | "turn" | "result";

export interface AuthorityPin {
  authorityNodeId: string;
  publicKey:       string;
  serverOrigin:    string;
}

export interface AuthorityProofRequest {
  nonce: string;
}

export interface AuthorityProofPayload {
  authorityNodeId: string;
  browserOrigin:   string;
  deviceId:        string;
  expiresAt:       string;
  issuedAt:        string;
  nonce:           string;
  ownerMemberId:   string;
  publicKey:       string;
  signature:       string;
  teamId:          string;
}

export interface AuthorityProof {
  messageId:       string;
  payload:         Payload;
  protocolVersion: ProtocolVersion;
  timestamp:       string;
  type:            Type;
}

export interface Payload {
  authorityNodeId: string;
  browserOrigin:   string;
  deviceId:        string;
  expiresAt:       string;
  issuedAt:        string;
  nonce:           string;
  ownerMemberId:   string;
  publicKey:       string;
  signature:       string;
  teamId:          string;
}

export type ProtocolVersion = "1.0";

export type Type = "authority.proof";

export interface AuthorityAgentMapping {
  localAgentId:      string;
  name:              string;
  projectionAgentId: string;
}

export interface AuthorityConnector {
  credentialDir: string;
  deviceId:      string;
  label:         string;
  mode:          Mode;
  ownerMemberId: string;
  pin:           AuthorityConnectorPin;
  projections:   [AuthorityConnectorProjection, ...AuthorityConnectorProjection[]];
  teamId:        string;
}

export type Mode = "device";

export interface AuthorityConnectorPin {
  authorityNodeId: string;
  publicKey:       string;
  serverOrigin:    string;
}

export interface AuthorityConnectorProjection {
  localAgentId:      string;
  name:              string;
  projectionAgentId: string;
}

export interface AuthorityConnectionsConfig {
  connectors:    Connector[];
  primary:       Primary;
  schemaVersion: number;
}

export interface Connector {
  credentialDir: string;
  deviceId:      string;
  label:         string;
  mode:          Mode;
  ownerMemberId: string;
  pin:           ConnectorPin;
  projections:   [ConnectorProjection, ...ConnectorProjection[]];
  teamId:        string;
}

export interface ConnectorPin {
  authorityNodeId: string;
  publicKey:       string;
  serverOrigin:    string;
}

export interface ConnectorProjection {
  localAgentId:      string;
  name:              string;
  projectionAgentId: string;
}

export interface Primary {
  authorityNodeId: string;
  publicKey:       string;
  serverOrigin:    string;
}

export interface AuthoritySpace {
  authorityNodeId: string;
  browserOrigin:   string;
  kind:            Kind;
  label:           string;
  teamId:          string;
}

export type Kind = "hosted" | "remote";

export interface AuthoritySpaceDirectory {
  schemaVersion: number;
  spaces:        Space[];
}

export interface Space {
  authorityNodeId: string;
  browserOrigin:   string;
  kind:            Kind;
  label:           string;
  teamId:          string;
}

