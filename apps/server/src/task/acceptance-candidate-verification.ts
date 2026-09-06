import type Database from "better-sqlite3";
import type { ResultAcceptanceEvidence } from "@convene-wire/contracts/task-result";
import type {
  RepositoryCheckpoint, RepositoryOperationRequest, VerificationReceipt
} from "@convene-wire/contracts/execution-plan";
import {
  assertExecutionCommand, executionOperationDigest
} from "@convene-wire/contracts/execution-validation";
import type { TaskArtifactRecord } from "./artifact-repository.js";

type Artifact = ResultAcceptanceEvidence["artifacts"][number];
type Candidate = Artifact["candidates"][number];
type Profile = Candidate["requiredProfiles"][number];
type Scope = {
  taskId: string; roomId: string; definitionRevision: number; criteriaRevision: number;
};
const pin = (profile: Profile): string =>
  JSON.stringify([profile.profileId, profile.revision, profile.digest]);
const same = (left: unknown, right: unknown): boolean =>
  executionOperationDigest(left) === executionOperationDigest(right);

/** Inspection only: this must never admit verification or create a gate proof. */
export function inspectArtifactVerification(
  database: Database.Database,
  artifact: TaskArtifactRecord,
  scope: Scope
): Artifact {
  if (artifact.taskId !== scope.taskId || artifact.roomId !== scope.roomId) {
    throw new Error("Acceptance Artifact is outside the Result scope");
  }
  const rows = database.prepare(`
    SELECT checkpoint.checkpoint_json, capture.request_json, count(*) OVER () AS total
    FROM repository_checkpoints checkpoint
    JOIN repository_capture_operations capture ON capture.operation_id = checkpoint.operation_id
    WHERE EXISTS (SELECT 1 FROM repository_checkpoint_outputs output
      WHERE output.checkpoint_id = checkpoint.checkpoint_id
        AND output.artifact_id = ? AND output.artifact_revision = ?)
      AND json_extract(checkpoint.checkpoint_json, '$.scope.taskId') = ?
      AND json_extract(checkpoint.checkpoint_json, '$.scope.roomId') = ?
      AND json_extract(checkpoint.checkpoint_json, '$.scope.definitionRevision') = ?
      AND json_extract(checkpoint.checkpoint_json, '$.scope.criteriaRevision') = ?
    ORDER BY checkpoint.checkpoint_id COLLATE BINARY LIMIT 10
  `).all(artifact.artifactId, artifact.artifactRevision, scope.taskId, scope.roomId,
    scope.definitionRevision, scope.criteriaRevision) as Array<{
      checkpoint_json: string; request_json: string; total: number;
    }>;
  return {
    artifactId: artifact.artifactId,
    artifactRevision: artifact.artifactRevision,
    type: artifact.type,
    contentSha256: artifact.contentSha256,
    contentSizeBytes: artifact.contentSizeBytes,
    omittedCandidates: (rows[0]?.total ?? 0) - rows.length,
    candidates: rows.map((row) => candidateVerification(database, artifact,
      JSON.parse(row.checkpoint_json), JSON.parse(row.request_json)))
  };
}

function candidateVerification(
  database: Database.Database,
  artifact: TaskArtifactRecord,
  checkpoint: RepositoryCheckpoint,
  capture: RepositoryOperationRequest
): Candidate {
  assertExecutionCommand("executionCheckpoint", checkpoint);
  const node = database.prepare(`
    SELECT node_json, task_id, definition_revision, criteria_revision
    FROM execution_plan_nodes WHERE plan_id = ? AND revision = ? AND node_key = ?
  `).get(checkpoint.scope.planId, checkpoint.scope.planRevision, checkpoint.scope.nodeKey) as {
    node_json: string; task_id: string; definition_revision: number; criteria_revision: number;
  } | undefined;
  const profiles = node ? JSON.parse(node.node_json).verificationProfiles as Array<
    Profile & { required: boolean }
  > : [];
  const requiredProfiles = profiles.filter((profile) => profile.required)
    .map(({ profileId, revision, digest }) => ({ profileId, revision, digest }))
    .sort((left, right) => pin(left).localeCompare(pin(right), "en-US"));
  const output = checkpoint.outputs.find(({ artifact: output }) =>
    output.artifactId === artifact.artifactId && output.artifactRevision === artifact.artifactRevision
  )?.artifact;
  const { digest, ...unsignedCheckpoint } = checkpoint;
  const validCandidate = Boolean(node && node.task_id === checkpoint.scope.taskId &&
    node.definition_revision === checkpoint.scope.definitionRevision &&
    node.criteria_revision === checkpoint.scope.criteriaRevision &&
    artifact.sourceRunId === checkpoint.scope.runId && artifact.contentMode === "snapshot_blob" &&
    output?.contentDigest === artifact.contentSha256 && output?.byteLength === artifact.contentSizeBytes &&
    output?.kind === artifact.type && digest === executionOperationDigest(unsignedCheckpoint) &&
    capture.operationId === checkpoint.operationId && same(capture.execution, checkpoint.scope));
  const rows = database.prepare(`
    SELECT receipt.receipt_json, receipt.receipt_digest, operation.request_json,
      operation.request_digest, count(*) OVER () AS total
    FROM repository_verification_operations operation
    JOIN verification_receipts receipt ON receipt.operation_id = operation.operation_id
    WHERE operation.checkpoint_id = ?
    ORDER BY receipt.verification_id COLLATE BINARY LIMIT 100
  `).all(checkpoint.checkpointId) as Array<{
    receipt_json: string; receipt_digest: string; request_json: string;
    request_digest: string; total: number;
  }>;
  let invalid = false;
  const receipts = rows.flatMap((row): Candidate["receipts"] => {
    const receipt = JSON.parse(row.receipt_json) as VerificationReceipt;
    const request = JSON.parse(row.request_json) as RepositoryOperationRequest;
    try {
      assertExecutionCommand("verificationReceipt", receipt);
      if (!validCandidate || receipt.integrationOperationId !== null ||
        receipt.authority.kind !== "bridge" || receipt.authority.deviceId !== checkpoint.scope.deviceId ||
        receipt.operationId !== request.operationId || receipt.requestDigest !== row.request_digest ||
        receipt.requestDigest !== request.requestDigest ||
        row.receipt_digest !== executionOperationDigest(receipt) ||
        !same(receipt.execution, checkpoint.scope) || !same(request.execution, checkpoint.scope) ||
        !same(receipt.plan, capture.plan) || !same(request.plan, capture.plan) ||
        receipt.repositoryId !== checkpoint.repositoryId || receipt.bindingId !== checkpoint.bindingId ||
        receipt.candidateCommit !== checkpoint.candidateCommit ||
        receipt.candidateTree !== checkpoint.candidateTree || receipt.inputDigest !== checkpoint.inputDigest ||
        request.action.kind !== "verify" ||
        request.action.verify?.candidateCommit !== checkpoint.candidateCommit ||
        request.action.verify.candidateTree !== checkpoint.candidateTree ||
        request.action.verify.inputDigest !== checkpoint.inputDigest ||
        !same(receipt.profile, request.action.verify.profile) ||
        !profiles.some((profile) => pin(profile) === pin(receipt.profile)) ||
        (receipt.outcome === "passed" && receipt.exitCode !== 0)) {
        invalid = true;
        return [];
      }
    } catch {
      invalid = true;
      return [];
    }
    return [{
      verificationId: receipt.verificationId,
      operationId: receipt.operationId,
      receiptDigest: row.receipt_digest,
      profile: receipt.profile,
      outcome: receipt.outcome
    }];
  });
  const omittedReceipts = (rows[0]?.total ?? 0) - receipts.length;
  const requiredReceipts = receipts.filter((receipt) =>
    requiredProfiles.some((profile) => pin(profile) === pin(receipt.profile))
  );
  let status: Candidate["status"] = "incomplete";
  if (!validCandidate || invalid || omittedReceipts > 0) status = "unavailable";
  else if (requiredProfiles.length === 0) status = "not_configured";
  else if (requiredReceipts.some(({ outcome }) => outcome === "failed")) status = "failed";
  else if (requiredProfiles.every((profile) => {
    const matching = requiredReceipts.filter((receipt) => pin(receipt.profile) === pin(profile));
    return matching.length === 1 && matching[0]!.outcome === "passed";
  })) status = "passed";
  return {
    checkpointId: checkpoint.checkpointId,
    runId: checkpoint.scope.runId,
    planId: checkpoint.scope.planId,
    planRevision: checkpoint.scope.planRevision,
    nodeKey: checkpoint.scope.nodeKey,
    candidateCommit: checkpoint.candidateCommit,
    candidateTree: checkpoint.candidateTree,
    inputDigest: checkpoint.inputDigest,
    requiredProfiles, receipts, omittedReceipts, status
  };
}
