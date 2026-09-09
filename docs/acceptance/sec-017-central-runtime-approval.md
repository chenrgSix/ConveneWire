# SEC-017: Continue the same Runtime after Central approval

Date: 2026-09-09. Authority: [ADR-0063](../adr/0063-forward-runtime-approvals-to-device-owner.md).

## Result

The client can opt in once to **Central approval**. Ordinary Codex conversation
then retains its sandbox and sends supported permission callbacks to the exact
Device owner in Central. **Allow once** or **Deny** answers the original callback;
neither creates a new Task, Run, authorization or Runtime process. Full trust is
a separate mode and does not exercise this approval path.

The production client controls and Web dialog were exercised on an isolated
local Central and Go Bridge. A deterministic Codex JSON-RPC subprocess requested
three approvals. The browser enabled client consent, allowed a command, denied a
second command and allowed a file change. Each target file was absent before
review; only the two allowed operations wrote a file. The original process
continued for every decision. There were exactly three Runs, three approvals,
zero development work authorizations and no model calls. Revocation returned the
fixture to restricted mode at revision 2. Its owned processes and temporary root
were removed.

- [Browser/process receipt](assets/sec-017/summary.json)
- [Client consent](assets/sec-017/client-central-approval.png)
- [Command approval](assets/sec-017/central-command-approval.png)
- [File approval](assets/sec-017/central-file-approval.png)

The final automatic process replay also passed after the audit-decision schema
change: same three operations and side effects in 10.8 seconds. Browser review
used the same Runtime policy handshake and UI; it was not a simulated click on
a static page. These results cover local process interoperability, not live
model behavior, native Windows/macOS Desktop interaction, CI or a release.

## Authority and lifecycle

Local consent is exact-pairing-bound, revisioned and default-off. Mode changes
drain execution before saving/reconnecting; failure to persist cannot restart
the prior broader worker. Only non-private managed Codex Agents advertise the
in-memory capability. Delivery requires its current connection publication and
frozen Run pin. Restricted, full-trust and governed paths retain their gates.

The adapter explicitly sets `on-request` and reviewer `user`, and requires the
Runtime to confirm both before starting a turn. Installed Codex 0.153.4 schema
generation confirmed the start/resume parameters and responses. Unsupported
reviewers or missing confirmation fail closed. No model was invoked for this
compatibility check.

Each bounded request fixes the operation details, SHA-256, Run, Agent, Device,
owner, consent revision and connection epoch. Dedicated HTTPS uses the paired
Device credential and rejects redirects. Only a full owner Web session with
current Room membership can list or decide. Team administrators, another owner,
Device tokens and client-scoped Web entry cannot substitute for that session.
Recognized secret material is rejected before transport. Details do not enter
Room messages or activity.

Replay requires identical content. Decisions are single-operation and
irreversible; closing a dialog makes no decision. Migration 0092 preserves the
original human choice separately from delivery expiry. Cancellation intents,
deadline/expiry, owner/membership removal, connection replacement and Central
restart prevent pending or previously allowed delivery from continuing.
Cancellation interrupts the waiting subprocess through its existing lifecycle.

## Verification

All checks below passed locally:

- Contracts: 119 Node tests, deterministic regeneration/current check, TypeScript
  and Go schema tests, including 15 shared approval cases.
- Server: 11 approval tests including owner/session isolation, changed request,
  wrong digest/Device, replay, secret rejection, stale revision, disconnect,
  expiry, cancellation and restart; 26 existing development-work tests also passed.
- Bridge: relevant config, connection, console, bridgecore and Runtime packages
  under `-race`; affected package `go vet`; subprocess allow/deny/cancel, exact
  reply validation, redirect rejection and reviewer-confirmation negatives.
- Web: all 327 tests and TypeScript; Server/Web builds; 63 embedded client UI
  tests and embedded JavaScript syntax check.
- Real Central/Go Bridge/deterministic Runtime interoperability and two browser
  review passes. Final screenshots reflect explicit action styles and pending
  sidebar count.

During verification an existing prompt contract assertion caught wording drift
on the restricted path; that phrase was restored and affected race tests rerun.
A new cancellation test exposed the interval between cancellation intent and
terminal Run acknowledgement; requests now invalidate on the intent itself.
The final audit test verifies original human decisions survive that expiry.

## Owner test

1. In the paired client, open **受控开发 → 设备执行权限**, acknowledge the
   displayed disclosure, then choose **开启中心审批**. Use the mode summary to
   verify it saved; do not select full trust for this test.
2. Sign in to Central with the Device owner's full account and select the Team
   containing the Codex Agent. Continue in the existing Room with `@Agent`.
3. Ask for one harmless operation outside the configured writable workspace,
   explicitly requesting the Runtime permission mechanism. For example, create
   a uniquely named test file in the home directory when the workspace is a
   repository beneath it. An already-permitted workspace write need not prompt.
4. Wait for **权限审批**. Verify the operation and path, then choose **允许本次**.
   The pending request disappears and the original task continues. Repeat with
   another unique file and **拒绝**; that operation must not write its target.

The first slice supports command execution and exact file-change callbacks.
Pi/generic runtimes, private/governed runs, session-wide grants, stdin injection,
network-only approval requests and other interactive methods are excluded.
An actual model must emit a supported permission request to exercise the live
path. Default-off owner settings were not changed by this implementation.
