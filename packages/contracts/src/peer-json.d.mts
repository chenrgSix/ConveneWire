export const peerJsonMaximumBytes: number;
export const peerJsonMaximumDepth: number;
export function parsePeerJson(input: string | Uint8Array, options?: { integerOnly?: boolean }): unknown;
export function canonicalPeerJson(value: unknown): Uint8Array;
