import type { CoreRepository } from "../data/core-repository.js";
import type { RunRecord, RunRepository } from "../run/run-repository.js";
import { terminalRunStates, terminalTurnStates } from "./discussion-state.js";
import type { DiscussionRepository } from "./discussion-repository.js";
import type { DiscussionTurn, DiscussionWave } from "./discussion-types.js";
import type { DiscussionDisclosureEvidence } from "./discussion-disclosure-evidence.js";
import {
  hashDiscussionReply,
  parseAgentAssessment
} from "./progress-evaluator.js";

export interface WaveSettlement {
  discussionId: string;
  wave: DiscussionWave | null;
  turns: DiscussionTurn[];
  ready: boolean;
}

export class WaveSettlementService {
  public constructor(
    private readonly core: CoreRepository,
    private readonly repository: DiscussionRepository,
    private readonly runs: RunRepository,
    private readonly disclosures?: DiscussionDisclosureEvidence
  ) {}

  public settle(runId: string, now: string): WaveSettlement | null {
    const run = this.runs.getRun(runId);
    const turn = this.repository.findTurnByRun(runId);
    if (!run || !turn || !terminalRunStates.has(run.state)) return null;
    if (!turn.waveId) {
      throw new Error(`Discussion Turn has no Wave: ${turn.turnId}`);
    }
    if (!terminalTurnStates.has(turn.state) && this.runs.isOwnerPrivateOutput(runId)) {
      return this.settlePrivate(run, turn, now);
    }
    const output = this.core.findAgentReply(
      turn.inputMessageId,
      turn.speakerAgentId
    );
    const replyEvent = this.runs.listEvents(runId)
      .filter(({ event }) => event.type === "reply")
      .at(-1)?.event as { assessment?: unknown } | undefined;
    const successful = run.state === "completed" && output !== undefined;
    this.repository.settleTurn({
      turnId: turn.turnId,
      outputMessageId: successful ? output.messageId : null,
      state: successful
        ? "completed"
        : run.state === "canceled"
          ? "canceled"
          : "failed",
      assessment: successful ? parseAgentAssessment(replyEvent?.assessment) : null,
      replyHash: successful ? hashDiscussionReply(output.content) : null,
      terminalReason: successful ? null : this.terminalReason(run, output !== undefined),
      now
    });
    const wave = this.repository.getWave(turn.waveId) ?? null;
    const turns = this.repository.listTurnsForWave(turn.waveId);
    return {
      discussionId: turn.discussionId,
      wave,
      turns,
      ready: wave?.state === "open" &&
        turns.every(({ state }) => terminalTurnStates.has(state))
    };
  }

  private settlePrivate(run: RunRecord, turn: DiscussionTurn, now: string): WaveSettlement {
    const wave = this.repository.getWave(turn.waveId!)!;
    const discussion = this.repository.get(turn.discussionId)!;
    const canceled = discussion.state === "canceled" || run.state === "canceled";
    const released = !canceled && wave.state === "open" && run.state === "completed" && turn.kind === "discussion"
      ? this.disclosures?.forTurn(turn, wave.deadlineAt) : undefined;
    if (!released && !canceled && run.state === "completed" && wave.state === "open" &&
      Date.parse(now) < Date.parse(wave.deadlineAt) && !discussion.requestedAction &&
      discussion.state === "active" && turn.kind === "discussion") {
      this.repository.awaitDisclosure(turn.turnId, now);
    } else {
      this.repository.settleTurn({ turnId: turn.turnId,
        outputMessageId: released?.messageId ?? null,
        state: released ? "completed" : canceled ? "canceled" : "failed",
        assessment: released ? { newEvidenceRefs: [released.result.resultId] } : null,
        replyHash: released ? hashDiscussionReply(released.result.proposal.summary) : null,
        terminalReason: released ? "disclosure_released" : canceled ? "disclosure_canceled" :
          run.state !== "completed" ? this.terminalReason(run, false) : "disclosure_unavailable",
        now });
    }
    const turns = this.repository.listTurnsForWave(wave.waveId);
    return { discussionId: turn.discussionId, wave, turns,
      ready: wave.state === "open" && turns.every(({ state }) => terminalTurnStates.has(state)) };
  }

  private terminalReason(run: RunRecord, hasOutput: boolean): string {
    if (this.runs.listEvents(run.runId).some(({ event }) =>
      event.type === "status" && event.status === "input_required"
    )) {
      return "input_required";
    }
    if (run.state === "completed" && !hasOutput) return "completed_without_reply";
    return `run_${run.state}`.slice(0, 160);
  }
}
