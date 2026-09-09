import type { PeerProofPayload } from "../generated/typescript/peer.js";
export const peerProofLifetimeSeconds: number;
export const peerProofClockSkewSeconds: number;
export const peerInvitationMaximumSeconds: number;
export const peerSettlementMaximumSeconds: number;
export function peerDigest(value: unknown): string;
export function peerProofTranscript(payload: PeerProofPayload): Uint8Array;
export function peerProofTimeValid(payload: PeerProofPayload, now: number): boolean;
