# ADR-0061: Continue development from conversation

- Status: Accepted
- Date: 2026-09-09
- Owner: Run, Bridge, Execution and Web
- Amends: [ADR-0060](0060-preauthorize-local-work-policies.md)

## Context

The owner rejected the separate development form: an ordinary `@Agent` request
must use the same development capabilities without asking the human to select
execution parameters, repeat a goal or manually supply acceptance criteria.
The explicit-form acceptance in QA-089 did not close everyday conversation.

## Decision

Keep the existing Room composer as the human entry. A capable Codex Bridge
handles a direct, single-Agent human request in a read-only conversational
turn. The Agent answers reading/review/discussion requests normally. When the
human intent requires repository changes, it returns a bounded structured
development proposal with a title and acceptance criteria. No keyword router
classifies messages. Quoted content is context, never additional authority.

Central binds the proposal to its authenticated Device, exact delivered Run,
original human Message and Task. It waits for the conversational Run to finish
successfully, then selects exactly one currently matching owner work policy.
The existing negotiation, derived grant, isolated workspace, capture and named
verification paths remain authoritative. Source instructions and bounded Room
context accompany the work; generated summaries cannot replace human intent.
The source Task's remaining budget bounds the continuation and is reserved
durably. Each source Run can produce at most one immutable proposal and one
continuation. No proposal authorizes integration, push or deployment.

Missing/overlapping policy, offline device, invalidated Task, expired budget or
denied negotiation produces an actionable message in the original conversation.
Successful admission and delivery link back to that same conversation. Retry,
reconnect, cancellation and restart cannot duplicate work or silently fall back
to ungoverned writes. Reading does not create a development plan or candidate.

Capability negotiation and optional wire fields preserve old Bridge behavior.
Discussion, handoff, private-output and already-governed Runs do not become new
development proposals. No real model is invoked during routine verification.
The legacy initiation API remains compatible, but the separate form is removed
from the primary Room interface.

## Acceptance

One ordinary composer submission can produce a read-only answer or a governed
development continuation with actual capture/verification receipts. Verify
original context, exact replay, source cancellation, out-of-order/late events,
offline/reconnect, denied authority, budget bounds and no-plan reading behavior.
Verify the production UI has one conversation entry and retains delivery links.
Delivery status lives only in `docs/TASKS.md`.
