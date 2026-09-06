import React, { useEffect, useId, useMemo, useState } from "react";
import type { ResultAcceptanceEvidence } from "@convene-wire/contracts/task-result";
import { captureWebSessionScope, jsonRequest } from "../../api-client.js";
import type { Locale } from "../../i18n.js";

type Contribution = NonNullable<ResultAcceptanceEvidence["criteria"][number]["candidate"]>;
const labels: Record<string, [string, string]> = {
  satisfied: ["声明满足", "Claimed satisfied"], unresolved: ["尚未确定", "Unresolved"],
  not_satisfied: ["声明未满足", "Claimed not satisfied"], not_applicable: ["声明不适用", "Claimed not applicable"],
  proposed: ["待审核", "Proposed"], accepted: ["已接受", "Accepted"],
  rejected: ["已拒绝的历史", "Rejected history"], superseded: ["已替代的历史", "Superseded history"],
  missing_claim: ["本结果尚未回应", "No claim in this Result"],
  earlier_evidence_not_referenced: ["此前贡献有本结果未引用的证据", "Earlier evidence is not referenced by this Result"],
  differing_coverage: ["前后覆盖声明不同", "Coverage claims differ"],
  claim_without_evidence: ["声明未引用证据", "Claim has no evidence reference"],
  passed: ["已配置的必需检查通过", "Configured required checks passed"],
  failed: ["必需检查失败", "Required check failed"],
  incomplete: ["必需检查尚未确认通过", "Required checks not confirmed"],
  not_configured: ["未配置必需检查", "No required checks configured"],
  unavailable: ["无法确认候选与验证的完整对应", "Candidate verification cannot be fully matched"]
};
const outcomes: Record<string, [string, string]> = {
  passed: ["通过", "Passed"], failed: ["失败", "Failed"], timed_out: ["超时", "Timed out"],
  canceled: ["已取消", "Canceled"], outcome_unknown: ["结果未知", "Outcome unknown"]
};

export function ResultAcceptancePanel({ taskId, resultId, taskRevision, refreshKey, locale, token }: {
  taskId: string; resultId: string; taskRevision: number; refreshKey: string;
  locale: Locale; token: string | undefined;
}) {
  const regionId = useId();
  const [expanded, setExpanded] = useState(false);
  const [reload, setReload] = useState(0);
  const scope = useMemo(() => ({ taskId, resultId, token, taskRevision, refreshKey, reload,
    sessionValid: captureWebSessionScope()
  }), [taskId, resultId, token, taskRevision, refreshKey, reload]);
  const [loaded, setLoaded] = useState<{
    scope: typeof scope; evidence?: ResultAcceptanceEvidence; failed?: boolean;
  } | null>(null);
  // Scope identity fences stale data at render time, including before effect cleanup.
  const visible = loaded?.scope === scope && scope.sessionValid() ? loaded : null;
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    const valid = () => !controller.signal.aborted && scope.sessionValid();
    setLoaded(null);
    void jsonRequest<ResultAcceptanceEvidence>(`/api/results/${scope.resultId}/acceptance-evidence`,
      { signal: controller.signal, cache: "no-store" }, scope.token).then((evidence) => {
      if (!valid()) return;
      if (evidence.version !== 1 || evidence.taskId !== scope.taskId || evidence.resultId !== scope.resultId) {
        throw new Error("Acceptance evidence scope mismatch");
      }
      setLoaded({ scope, evidence });
    }).catch(() => { if (valid()) setLoaded({ scope, failed: true }); });
    return () => controller.abort();
  }, [expanded, scope]);
  const t = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const label = (value: string) => labels[value]?.[locale === "zh-CN" ? 0 : 1] ?? value;
  const evidence = visible?.evidence;
  const showContribution = (contribution: Contribution) => <div className="acceptance-claim">
    <strong>{label(contribution.claim.coverage)}</strong>
    <p>{contribution.claim.explanation}</p>
    <small>Result v{contribution.resultVersion} · {label(contribution.state)}</small>
    <small>{t("提议来源", "Proposed by")}: {contribution.proposedBy.memberId ?? contribution.proposedBy.agentId ?? contribution.proposedBy.discussionId ?? contribution.proposedBy.kind}</small>
    {contribution.proposedBy.runId && <small>Run: {contribution.proposedBy.runId}</small>}
    <small>{contribution.resultId}</small>
    {contribution.sources.length === 0 ? <p>{t("未引用证据", "No evidence referenced")}</p> : <ul className="acceptance-sources">
      {contribution.sources.map((source) => {
        const artifact = evidence?.artifacts.find(({ artifactId }) => artifactId === source.artifactId);
        const identity = source.artifactId ?? source.messageId ?? source.memoryId ?? source.discussionId ?? `${source.runId} #${source.sequence}`;
        return <li key={source.evidenceRefId}><span>{source.kind} · {identity}{artifact && ` · r${artifact.artifactRevision}`}</span></li>;
      })}
    </ul>}
  </div>;
  return <section className="result-acceptance">
    <button aria-controls={regionId} aria-expanded={expanded} className="acceptance-toggle" onClick={() => setExpanded(!expanded)} type="button">
      <span>{t("逐项核对证据", "Review evidence by criterion")}</span><span aria-hidden="true">{expanded ? "−" : "+"}</span>
    </button>
    {expanded && <div id={regionId} className="acceptance-content">
      <div className="acceptance-intro">
        <p>{t("对照本结果与此前贡献。覆盖状态是提议者的声明；验证通过只覆盖已配置的检查，最终接受仍需审核。", "Compare this Result with earlier contributions. Coverage is the proposer's claim; verification covers configured checks only. Acceptance still requires review.")}</p>
        <button className="work-inline-link" disabled={!visible} onClick={() => setReload(reload + 1)} type="button">{t("刷新证据", "Refresh evidence")}</button>
      </div>
      {!visible && <p role="status">{t("正在读取证据…", "Loading evidence…")}</p>}
      {visible?.failed && <p role="alert">{t("无法读取证据，请刷新并确认仍有访问权限。", "Cannot read evidence. Refresh and check your access.")}</p>}
      {evidence && <>
        <p className="acceptance-revisions">{t("本结果的定义 / 标准版本", "Result definition / criteria revision")}: {evidence.definitionRevision} / {evidence.criteriaRevision}</p>
        {evidence.stale && <p className="work-warning">{t("旧版本证据：以下保留原验收标准。当前定义 / 标准版本为", "Stale evidence: original criteria are shown. Current definition / criteria revision is")} {evidence.currentDefinitionRevision} / {evidence.currentCriteriaRevision}</p>}
        {evidence.omittedResults > 0 && <p className="work-warning">{t(`仅纳入最近 ${evidence.historyLimit} 个匹配历史 Result，另有 ${evidence.omittedResults} 个未纳入；不能据此认定没有更早证据。`, `Only the latest ${evidence.historyLimit} matching earlier Results are included; ${evidence.omittedResults} omitted. This does not establish absence of earlier evidence.`)}</p>}
        {evidence.criteria.length === 0 && <p>{t("此版本未定义正式验收标准。", "No canonical criteria were defined for this revision.")}</p>}
        {evidence.criteria.map((row) => <article className="acceptance-row" key={row.criterion.criterionKey}>
          <header><h5>{row.criterion.description}</h5><span>{row.criterion.required ? t("必需", "Required") : t("可选", "Optional")}</span></header>
          <small className="acceptance-key">{row.criterion.criterionKey}</small>
          {row.diagnostics.length > 0 && <ul className="acceptance-diagnostics" aria-label={t("待核对项", "Items to inspect")}>{row.diagnostics.map((diagnostic) => <li key={diagnostic}>{label(diagnostic)}</li>)}</ul>}
          <div className="acceptance-comparison">
            <section><h6>{t("本结果的回应", "This Result's claim")}</h6>{row.candidate ? showContribution(row.candidate) : <p>{t("没有对应声明，请核对此项要求。", "No claim for this criterion. Inspect the requirement.")}</p>}</section>
            <section><h6>{t("此前贡献", "Earlier contributions")}</h6>{row.contributions.length === 0 ? <p>{t("已纳入的历史 Result 中无对应声明。", "No matching claims in the included earlier Results.")}</p> : row.contributions.map((contribution) => <div key={contribution.resultId}>{showContribution(contribution)}</div>)}</section>
          </div>
        </article>)}
        {evidence.artifacts.length > 0 && <section className="acceptance-verification">
          <h5>{t("成果与独立验证", "Artifacts and independent verification")}</h5>
          {evidence.artifacts.map((artifact) => <article key={artifact.artifactId}>
            <strong>{artifact.type} · r{artifact.artifactRevision}</strong><small>{artifact.artifactId}</small>
            {artifact.candidates.length === 0 && <p>{t("没有匹配的代码候选验证。来源引用或快照完整性不等于标准已满足。", "No matching code candidate verification. A reference or snapshot integrity does not establish criterion satisfaction.")}</p>}
            {artifact.omittedCandidates > 0 && <p>{t("未纳入的候选", "Candidates omitted")}: {artifact.omittedCandidates}</p>}
            {artifact.candidates.map((candidate) => <div className="acceptance-candidate" key={candidate.checkpointId}>
              <strong className="acceptance-check-status" data-status={candidate.status}>{label(candidate.status)}</strong>
              <p>{t("必需验证配置", "Required verifier profiles")}: {candidate.requiredProfiles.length} · {t("记录的回执", "Recorded receipts")}: {candidate.receipts.length}</p>
              {candidate.omittedReceipts > 0 && <p>{t("未纳入或未匹配的回执", "Omitted or unmatched receipts")}: {candidate.omittedReceipts}</p>}
              <details><summary>{t("查看候选与回执标识", "Inspect candidate and receipt identities")}</summary>
                <dl>
                  <div><dt>Artifact SHA-256</dt><dd>{artifact.contentSha256 ?? t("未记录", "Not recorded")}</dd></div>
                  <div><dt>Checkpoint</dt><dd>{candidate.checkpointId}</dd></div>
                  <div><dt>Run</dt><dd>{candidate.runId}</dd></div>
                  <div><dt>Plan / Node</dt><dd>{candidate.planId} · r{candidate.planRevision} · {candidate.nodeKey}</dd></div>
                  <div><dt>Commit</dt><dd>{candidate.candidateCommit}</dd></div>
                  <div><dt>Tree</dt><dd>{candidate.candidateTree}</dd></div>
                  <div><dt>Input digest</dt><dd>{candidate.inputDigest}</dd></div>
                </dl>
                <h6>{t("必需验证配置", "Required verifier profiles")}</h6>
                <ul>{candidate.requiredProfiles.map((profile) => <li key={`${profile.profileId}:${profile.revision}:${profile.digest}`}>{profile.profileId} · r{profile.revision}<small>{profile.digest}</small></li>)}</ul>
                <h6>{t("回执", "Receipts")}</h6>
                <ul>{candidate.receipts.map((receipt) => <li key={receipt.verificationId}>
                  <strong>{outcomes[receipt.outcome]?.[locale === "zh-CN" ? 0 : 1]}</strong> · {receipt.profile.profileId} · r{receipt.profile.revision}
                  <small>{receipt.verificationId} · {receipt.operationId}</small>
                  <small>{t("配置摘要", "Profile digest")}: {receipt.profile.digest}</small>
                  <small>{t("回执摘要", "Receipt digest")}: {receipt.receiptDigest}</small>
                </li>)}</ul>
              </details>
            </div>)}
          </article>)}
        </section>}
      </>}
    </div>}
  </section>;
}
