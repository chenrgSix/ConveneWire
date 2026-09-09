export const peerJsonMaximumBytes: number;
export const peerJsonMaximumDepth: number;
export function parsePeerJson(input: string | Uint8Array): unknown;
export function canonicalPeerJson(value: unknown): Uint8Array;
