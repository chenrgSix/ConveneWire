import type Database from "better-sqlite3";
import type {
  ResultAcceptanceEvidence, ResultProjection, ResultProposal
} from "@convene-wire/contracts/task-result";
import { ArtifactRepository } from "./artifact-repository.js";
import { inspectArtifactVerification } from "./acceptance-candidate-verification.js";
import type { AgentTaskRecord, AgentTaskRepository } from "./task-repository.js";
import type { ResultRepository } from "./result-repository.js";

type Criterion = ResultAcceptanceEvidence["criteria"][number];
type Contribution = NonNullable<Criterion["candidate"]>;
type Source = ResultProposal["sources"][number];
export interface DiscussionAcceptanceEvidence {
  taskId: string;
  definitionRevision: number;
  criteriaRevision: number;
  criteria: Criterion[];
  artifacts: ResultAcceptanceEvidence["artifacts"];
  omittedResults: number;
  runsWithoutCurrentResults: number;
}
const historyLimit = 10;

/** Source identity is global; evidenceRefId is local to one Result proposal. */
export function acceptanceSourceIdentity(source: Source): string {
  switch (source.kind) {
    case "artifact": return JSON.stringify([source.kind, source.artifactId]);
    case "run_event": return JSON.stringify([source.kind, source.runId, source.sequence]);
    case "message": return JSON.stringify([source.kind, source.messageId]);
    case "memory": return JSON.stringify([source.kind, source.memoryId]);
    case "discussion": return JSON.stringify([source.kind, source.discussionId]);
  }
}

/** A transactionally consistent read model, never an acceptance or proof authority. */
export class AcceptanceEvidenceService {
  private readonly artifacts: ArtifactRepository;

  public constructor(
    private readonly database: Database.Database,
    private readonly results: ResultRepository,
    private readonly tasks: AgentTaskRepository
  ) {
    this.artifacts = new ArtifactRepository(database);
  }

  public forResult(resultId: string): ResultAcceptanceEvidence {
    return this.database.transaction(() => {
      const candidate = this.results.get(resultId);
      if (!candidate) throw new Error("Acceptance Result is unavailable");
      const task = this.requireTask(candidate.taskId, candidate.roomId);
      const scope = {
        ...task,
        definitionRevision: candidate.proposal.definitionRevision,
        criteriaRevision: candidate.proposal.criteriaRevision
      };
      const history = this.history(scope, candidate.resultVersion);
      const criteria = this.criteria(scope, candidate, history.results);
      return {
        version: 1, taskId: task.taskId, resultId, resultVersion: candidate.resultVersion,
        definitionRevision: scope.definitionRevision, criteriaRevision: scope.criteriaRevision,
        currentDefinitionRevision: task.definitionRevision,
        currentCriteriaRevision: task.criteriaRevision,
        stale: task.definitionRevision !== scope.definitionRevision ||
          task.criteriaRevision !== scope.criteriaRevision,
        historyLimit, omittedResults: history.omittedResults, criteria,
        artifacts: this.artifactEvidence(scope, criteria)
      };
    })();
  }

  public forDiscussion(
    taskId: string, roomId: string, acceptedRunIds: readonly string[]
  ): DiscussionAcceptanceEvidence {
    return this.database.transaction(() => {
      const task = this.requireTask(taskId, roomId);
      const runIds = [...new Set(acceptedRunIds)];
      const history = this.history(task, null, runIds);
      const criteria = this.criteria(task, null, history.results);
      const structured = this.database.prepare(`
        SELECT count(DISTINCT proposed_by_run_id) AS total FROM task_results
        WHERE task_id = ? AND room_id = ? AND definition_revision = ? AND criteria_revision = ?
          AND proposed_by_kind IN ('managed_agent', 'manual_agent')
          AND proposed_by_run_id IN (SELECT value FROM json_each(?))
      `).get(taskId, roomId, task.definitionRevision, task.criteriaRevision,
        JSON.stringify(runIds)) as { total: number };
      return {
        taskId, definitionRevision: task.definitionRevision, criteriaRevision: task.criteriaRevision,
        criteria, artifacts: this.artifactEvidence(task, criteria),
        omittedResults: history.omittedResults,
        runsWithoutCurrentResults: runIds.length - structured.total
      };
    })();
  }

  private requireTask(taskId: string, roomId: string): AgentTaskRecord {
    const task = this.tasks.get(taskId);
    if (!task || task.roomId !== roomId) throw new Error("Acceptance Task scope is unavailable");
    return task;
  }

  private history(task: AgentTaskRecord, beforeVersion: number | null, runIds?: readonly string[]) {
    const rows = this.database.prepare(`
      SELECT result_id, count(*) OVER () AS total FROM task_results
      WHERE task_id = ? AND room_id = ? AND definition_revision = ? AND criteria_revision = ?
        AND (? IS NULL OR result_version < ?)
        AND (? IS NULL OR (proposed_by_kind IN ('managed_agent', 'manual_agent')
          AND proposed_by_run_id IN (SELECT value FROM json_each(?))))
      ORDER BY result_version DESC, result_id COLLATE BINARY LIMIT ?
    `).all(task.taskId, task.roomId, task.definitionRevision, task.criteriaRevision,
      beforeVersion, beforeVersion, runIds ? JSON.stringify(runIds) : null,
      JSON.stringify(runIds ?? []), historyLimit) as Array<{ result_id: string; total: number }>;
    return {
      results: rows.map((row) => this.results.get(row.result_id)!),
      omittedResults: (rows[0]?.total ?? 0) - rows.length
    };
  }

  private contribution(result: ResultProjection, criterionKey: string): Contribution | null {
    const claim = result.proposal.criterionClaims.find((claim) => claim.criterionKey === criterionKey);
    if (!claim) return null;
    return {
      resultId: result.resultId, resultVersion: result.resultVersion,
      state: result.state, proposedBy: result.proposedBy, claim,
      sources: result.proposal.sources.filter((source) => claim.evidenceRefIds.includes(source.evidenceRefId))
    };
  }

  private criteria(
    task: AgentTaskRecord, candidate: ResultProjection | null, history: ResultProjection[]
  ): Criterion[] {
    const rows = this.database.prepare(`
      SELECT criterion_key, description, required, ordinal FROM task_criteria_entries
      WHERE task_id = ? AND criteria_revision = ? ORDER BY ordinal, criterion_key COLLATE BINARY
    `).all(task.taskId, task.criteriaRevision) as Array<{
      criterion_key: string; description: string; required: number; ordinal: number;
    }>;
    return rows.map((row) => {
      const selected = candidate ? this.contribution(candidate, row.criterion_key) : null;
      const contributions = history.flatMap((result) => {
        const contribution = this.contribution(result, row.criterion_key);
        return contribution ? [contribution] : [];
      });
      const active = contributions.filter(({ state }) => state === "proposed" || state === "accepted");
      const diagnostics: Criterion["diagnostics"] = [];
      if (candidate && !selected) diagnostics.push("missing_claim");
      if (selected?.claim.coverage === "satisfied" && selected.sources.length === 0) {
        diagnostics.push("claim_without_evidence");
      }
      const selectedSources = new Set(selected?.sources.map(acceptanceSourceIdentity) ?? []);
      if (candidate && active.some(({ sources }) => sources.some((source) =>
        !selectedSources.has(acceptanceSourceIdentity(source))
      ))) diagnostics.push("earlier_evidence_not_referenced");
      const coverages = new Set([
        ...active.map(({ claim }) => claim.coverage),
        ...(selected ? [selected.claim.coverage] : [])
      ]);
      if (coverages.size > 1) diagnostics.push("differing_coverage");
      return {
        criterion: {
          criterionKey: row.criterion_key, description: row.description,
          required: row.required === 1, ordinal: row.ordinal
        },
        candidate: selected, contributions, diagnostics
      };
    });
  }

  private artifactEvidence(task: AgentTaskRecord, criteria: Criterion[]) {
    const ids = new Set(criteria.flatMap((row) => [
      ...(row.candidate ? [row.candidate] : []), ...row.contributions
    ]).flatMap(({ sources }) => sources.flatMap((source) =>
      source.kind === "artifact" ? [source.artifactId!] : []
    )));
    return [...ids].sort().map((id) => {
      const artifact = this.artifacts.get(id);
      if (!artifact) throw new Error("Acceptance Artifact source is unavailable");
      return inspectArtifactVerification(this.database, artifact, task);
    });
  }
}
