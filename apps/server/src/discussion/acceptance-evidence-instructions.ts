import { truncateUnicodeCodePoints } from "../domain/unicode-length.js";
import { redactSensitiveText } from "../security/redaction.js";
import type { DiscussionAcceptanceEvidence } from "../task/acceptance-evidence-service.js";

const length = (value: string): number => [...value].length;
const excerpt = (value: string, maximum: number): string => {
  const text = redactSensitiveText(value).replace(/\s+/gu, " ");
  return length(text) <= maximum ? text : `${truncateUnicodeCodePoints(text, maximum - 3)}...`;
};

export const criterionContributionGuidance =
  "Organize your contribution by the supplied canonical criterion keys: facts, exact source references, " +
  "inferences, assumptions, performed checks and unresolved gaps. When an authorized Result submission " +
  "tool is available, retain criterionClaims in an ordinary Result and cite its resultId in " +
  "newEvidenceRefs. Plain replies remain valid but are not automatically structured evidence.";

export const criterionFinalizationGuidance =
  "Address each supplied criterion: supported, unverified, conflicting or missing. Cite source identities " +
  "and explain material departures from earlier contributions. Check available contributions before " +
  "claiming evidence is missing; an omitted index row is not proof of absence. Claims and differing " +
  "coverage are not truth or error verdicts. Matching verifier passes cover their configured checks only. " +
  "Do not invent a defect or declare human acceptance.";

/** Complete bounded entries with explicit counts; no source bytes or verifier commands. */
export function acceptanceEvidenceInstruction(
  evidence: DiscussionAcceptanceEvidence, maximum: number
): string {
  if (evidence.criteria.length === 0 || maximum <= 0) return "";
  const header = [
    "## Criterion Evidence Index",
    `Task ${evidence.taskId}; definition ${evidence.definitionRevision}; criteria ${evidence.criteriaRevision}.`,
    "Attributed claims, not established facts. Source IDs do not grant source access.",
    `Prior Results omitted by history limit: ${evidence.omittedResults}; accepted Runs without offered current Results: ${evidence.runsWithoutCurrentResults}.`
  ].join("\n");
  const entries: Array<{ text: string; kind: "criterion" | "contribution" }> = [];
  for (const row of evidence.criteria) {
    entries.push({ kind: "criterion", text:
      `${row.criterion.criterionKey} [${row.criterion.required ? "required" : "optional"}]: ${excerpt(row.criterion.description, 240)}` });
  }
  for (const row of evidence.criteria) {
    for (const contribution of row.contributions) {
      const sources = contribution.sources.map((source) => {
        const identity = source.artifactId ?? source.messageId ?? source.memoryId ??
          source.discussionId ?? `${source.runId}:${source.sequence}`;
        const artifact = evidence.artifacts.find(({ artifactId }) => artifactId === source.artifactId);
        return artifact ? `${identity}@${artifact.artifactRevision}` : identity;
      });
      const checks = contribution.sources.flatMap((source) => evidence.artifacts
        .filter(({ artifactId }) => artifactId === source.artifactId)
        .flatMap(({ candidates }) => candidates.map((candidate) =>
          `${candidate.checkpointId}:${candidate.status}`)));
      entries.push({ kind: "contribution", text:
        `  ${row.criterion.criterionKey} <- ${contribution.resultId}@${contribution.resultVersion} ` +
        `[${contribution.state}; ${contribution.claim.coverage}]: ${excerpt(contribution.claim.explanation, 300)} ` +
        `sources=${sources.length ? sources.join(",") : "none"}; checks=${checks.length ? checks.join(",") : "none recorded"}` });
    }
  }
  const selected: typeof entries = [];
  const footer = () => {
    const omitted = entries.slice(selected.length);
    return `Index omissions: ${omitted.filter(({ kind }) => kind === "criterion").length} criteria; ` +
      `${omitted.filter(({ kind }) => kind === "contribution").length} contribution entries. ` +
      "Only displayed entries are represented; omitted or unstructured content is not proven absent.";
  };
  for (const entry of entries) {
    const next = [header, ...selected.map(({ text }) => text), entry.text, footer()].join("\n");
    if (length(next) > maximum) break;
    selected.push(entry);
  }
  const result = [header, ...selected.map(({ text }) => text), footer()].join("\n");
  if (length(result) <= maximum) return result;
  return truncateUnicodeCodePoints(
    "Criterion evidence index omitted by instruction limit; do not infer evidence absence.", maximum
  );
}
