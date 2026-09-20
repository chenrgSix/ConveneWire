package runtime

import (
	"context"

	contracts "convenewire.dev/contracts/generated/go"
)

func (c CodexAdapter) executeDesktop(ctx context.Context, request Request, emit EmitFunc) error {
	run := request.Run
	if c.Desktop == nil || run.TaskID == nil || run.DesktopAudienceDigest == nil || run.ParentRunID != nil || run.DiscussionSupplementalEvidence != nil || c.LocalApproval != nil || c.Config.AuthorityNodeID != "" || c.Config.OwnerPrivateOutput || run.OwnerPrivateOutput != nil && *run.OwnerPrivateOutput || run.ContextManifest != nil && run.ContextManifest.Execution != nil {
		return emitCodexFailure(ctx, emit, "DESKTOP_HANDOFF_UNAVAILABLE", "The original desktop conversation is unavailable; no replacement was started.")
	}
	// Room evidence is supplied explicitly; native conversation history stays in
	// the original Thread. No native Thread identifier enters logical session state.
	promptRun, receipt, err := prepareRoomContextForSession(run, RuntimeSessionBinding{}, contracts.Started)
	if err != nil {
		return emitCodexFailure(ctx, emit, "ROOM_CONTEXT_INVALID", "Room context coverage is invalid.")
	}
	promptRun.DeviceTrust = nil
	promptRun.CentralApproval = nil
	promptRun.ConversationWork = nil
	text := "The owner has explicitly attached this original Codex conversation to the Room below. Continue its existing history and workspace. Only the final answer for this turn will be shared with the reviewed Room audience. Do not bulk-copy private history. Execution uses the locally reviewed sandbox; previous full-access approvals do not apply.\n\n" + runtimePromptWithArtifacts(promptRun, request.Artifacts)
	working := contracts.Working
	if err = emit(ctx, Event{Status: &working}); err != nil {
		return err
	}
	reply, uncertain, err := c.Desktop.Continue(ctx, *run.TaskID, run.TargetAgentID, run.RoomID, *run.DesktopAdoptionID, *run.DesktopAudienceDigest, run.RunID, text)
	if err != nil {
		status := contracts.Failed
		code := "DESKTOP_HANDOFF_PAUSED"
		if uncertain || ctx.Err() != nil {
			status = contracts.OutcomeUnknown
			code = "DESKTOP_HANDOFF_UNKNOWN"
		}
		return emit(ctx, Event{Status: &status, Error: runtimeError(code, "Codex continuation is paused. Review the original conversation locally; the message was not automatically resent.")})
	}
	if err = emit(ctx, Event{Reply: reply}); err != nil {
		return err
	}
	completed := contracts.Completed
	var session *contracts.LogicalSessionStatus
	if run.Session != nil {
		cursor := run.Session.ContextCursor
		if receipt != nil {
			cursor = receipt.CoverageThroughSequence
		}
		session = &contracts.LogicalSessionStatus{Disposition: contracts.Resumed, ContextCursor: cursor, RoomContextConsumption: receipt}
	}
	return emit(ctx, Event{Status: &completed, Session: session})
}
