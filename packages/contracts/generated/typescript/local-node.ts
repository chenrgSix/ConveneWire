// Code generated from JSON Schema; DO NOT EDIT.

export interface LocalNodeIdentity {
  nodeId:        string;
  ownerUserId:   string;
  port:          number;
  schemaVersion: number;
  secret:        string;
}

export interface LocalNodeLaunch {
  controlToken:  string;
  identity:      Identity;
  schemaVersion: number;
}

export interface Identity {
  nodeId:        string;
  ownerUserId:   string;
  port:          number;
  schemaVersion: number;
  secret:        string;
}

export interface LocalNodeReady {
  launchProof:   string;
  nodeId:        string;
  origin:        string;
  schemaVersion: number;
}

export interface LocalNodeBinding {
  deviceId:      string;
  ownerMemberId: string;
  serverUrl:     string;
  teamId:        string;
  token:         string;
}

export interface LocalNodeControlState {
  binding:          Binding | null;
  consolePage?:     ConsolePage;
  consoleRequestId: string;
  handoffTaskId?:   string;
}

export interface Binding {
  deviceId:      string;
  ownerMemberId: string;
  serverUrl:     string;
  teamId:        string;
  token:         string;
}

export type ConsolePage = "agents" | "peers" | "handoff";

export interface DesktopHandoffRequest {
  action:          Action;
  adoptionId?:     string;
  audienceDigest?: string;
  runId?:          string;
  taskId:          string;
}

export type Action = "scope" | "confirm" | "validate" | "release";

export interface DesktopHandoffScope {
  adoptionId:     string;
  agentId:        string;
  agentName:      string;
  audience:       string[];
  audienceDigest: string;
  deviceId:       string;
  nodeId:         string;
  ownerMemberId:  string;
  roomId:         string;
  roomName:       string;
  state:          State;
  taskId:         string;
  taskTitle:      string;
  teamId:         string;
}

export type State = "available" | "attached" | "released" | "paused";

