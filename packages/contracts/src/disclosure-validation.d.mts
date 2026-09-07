import type { EvidenceDisclosureIntent } from "../generated/typescript/task-result.js";
export function assertDisclosure(kind: "disclosureIntent" | "disclosureGrant" | "disclosurePublishCommand" | "disclosureRevokeCommand" | "disclosureReceipt", value: unknown): void;
export function disclosureIntentDigest(value: EvidenceDisclosureIntent): string;
export function disclosureContentDigest(content: string): string;
