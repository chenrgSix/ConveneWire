# QA-089 unattended standing-work product acceptance

Date: 2026-09-08. Goal and authority:
[ADR-0060](../adr/0060-preauthorize-local-work-policies.md).
Delivery state is recorded only in [TASKS](../TASKS.md).

One policy was saved through the actual local Console form. The production Web
build then created two different development Tasks through Room's explicit
entry. Actual Central and Go Bridge processes exchanged the policy offer,
authorization request, refreshed grant inventory, receipt and governed Run.
Each Run wrote into its own isolated workspace, captured a real Git candidate,
published patch/commit artifacts and retained both command and browser
verification receipts. A full Bridge owner-process restart between the Tasks
preserved the policy. No further local confirmation occurred until the owner
explicitly revoked the parent after both Tasks completed.

The Runtime is a deterministic Codex protocol fixture, including permission
profile discovery and boundary-probe responses. This validates the product's
real transport, admission, filesystem, Git, verifier and UI composition; it does
not validate a live model's code quality or attest a real Codex installation.
The headless browser is a real dedicated Chrome for Testing Headless Shell
152.0.7977.82, with native sandbox enabled and disposable profile. The fixture
never modifies an installed Bridge, user's browser profile or actual project
source. The earlier desktop Edge updater side effect during verifier development
is separately disclosed in [VER-002](ver-002-browser-verification.md).

## Observed result

The final physical fixture passed in **34.97 seconds**. Its complete owned
temporary root was removed by the repository test lifecycle wrapper.

| Property | Observed evidence |
| --- | --- |
| Owner consent | One real local policy form save |
| Development initiation | Two production Web form submissions |
| Exact authority | Two distinct Task grants and two governed Runs |
| Delivery | Two physical checkpoints, patch and commit artifacts |
| Independent verification | Two command passes and two browser passes |
| Browser | Candidate input, click, text assertion and PNG for each Task |
| Recovery | Full Bridge restart between Tasks; identical request replay returns the original Task |
| Parent revocation | Both derived grants shown revoked; no available Room policy |
| Source checkout | Original HEAD and clean working tree preserved |
| Visual review field | Still `not_performed`; screenshot generation is not human acceptance |
| Duplicate effects | Exactly two Runs, two authorization rows and two checkpoints |

The receipt summary contains only disposable fixture identities:
[two-task-summary.json](assets/qa-089/two-task-summary.json).

Additional focused regressions cover changed scope/identity/profile/source,
unallowed initiator, expiry, stale connection epoch, unpublished grant receipts,
late authorization after cancellation and Central restart. See
[EXEC-012](exec-012-preauthorized-room-development.md) and
[BRG-077](brg-077-standing-work-policies.md). Negative cases are tested at their
authority boundaries; the physical browser test does not pretend to repeat every
fault combination end to end.

## Product surfaces

- [Local policy form](assets/qa-089/local-policy-ready.png),
  [saved policy](assets/qa-089/local-policy-saved.png),
  [parent and derived grants revoked](assets/qa-089/local-policy-revoked.png).
- [Room development entry at 1440 pixels](assets/qa-089/room-development-ready.png)
  and [900 pixels](assets/qa-089/room-development-compact.png).
- [Receipt-bound browser report](assets/qa-089/room-browser-evidence.png),
  [first candidate](assets/qa-089/candidate-1.png) and
  [second candidate](assets/qa-089/candidate-2.png).

The screenshots were visually inspected. Form controls, save/revoke outcomes,
Chinese content and report image containment were checked. The report image no
longer expands the viewport. Mobile widths below 900 pixels, English visual
layout, physical Windows/Linux, live Runtime calls, installed-client migration,
CI and external publication were not accepted by this run.

## Web behavior and regression gates

Room displays current path-free availability, source commit, output directories,
verifiers and task limits. An unavailable or ambiguous policy supplies an owner
action instead of an interactive Runtime approval. Submission sends a closed
command with a stable operation ID. Unconfirmed intent is retained in member-
and Room-scoped session storage before the request; reopening/retrying reuses
it. Malformed recovery data blocks new submission instead of overwriting an
unknown operation. Session changes cannot display late readiness or reports.
The delivery link opens the root Task's canonical execution evidence view.

Candidate commits from verification receipts are visible before Result adoption.
Authorized, executed, candidate captured, tests passed, screenshot generated,
Result accepted and integrated remain distinct states. A report is fetched only
on demand and matched to the receipt's Task, artifact ID, revision and SHA-256;
non-PNG or altered images cannot become executable markup.

Validation retained for the final implementation:

- 10 focused Web tests: request recovery, root delivery link, offline policy,
  stale session, corrupt storage, artifact preview and execution proof surfaces.
- 10 focused Server tests: work negotiation/admission plus bounded PNG projection.
- 63 embedded-client JavaScript regressions.
- Repository/Console work-policy race checks, browser race checks, command
  Runner/profile and verification coordinator replay checks; owning Go vet.
- Server/Web/contracts build, generated contract consistency, documentation lint,
  relative links and diff whitespace checks.

Reproduction commands are in
[development commands](../development-commands.md#standing-work-browser-acceptance).
Running without the browser environment variable exercises the API-only physical
Git/command path; it is not a substitute for the browser acceptance above.
