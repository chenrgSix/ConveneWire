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

