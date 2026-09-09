# ADR-0064: Isolate Task conversations and share explicit project context

- Status: Accepted
- Date: 2026-09-09
- Supersedes: Room-history injection in ADR-0014 and Room-wide default conversation presentation in ADR-0022

## Context

Room folders now contain individual Tasks. Users expect each Task to keep its
own conversation, while related work can use project conventions and cited
results. The previous planner merged Room history with Task history; native
Runtime sessions could also retain that mixed context after a Server update.

## Decision

Room remains the ordered storage and membership authority. Task becomes the
default conversation and execution-context boundary, including the default Task.
Web history, pagination, pending sends and live replies follow the selected Task.
Room sequence numbers remain unchanged; task-filtered cursors bind both IDs.

Runtime input uses only Task messages and Task projections. It never injects
automatic Room excerpts or rolling Room checkpoints. Explicit, provenance-bearing
Room long-term Memory remains the shared project knowledge surface. All Agents
working on the same Task receive that Task's context.

Cross-Task reuse is a bounded citation of accepted Results, through an existing
Result-to-child source edge or an explicit TASK-number reference in the Task goal
or current request. It includes source Task/Result/version and a navigation link,
never another Task's raw conversation. References stay in the same Room, obey
the Run capture time and do not grant execution or filesystem authority.

A versioned Task context policy partitions native Session bindings and Server
Artifact-consumption cursors, so new sessions receive a complete bounded bootstrap. Bridge
advertises support; Central sends the policy only to capable clients. Older
clients receive the existing start_new resume policy so an old mixed-context
session cannot reappear. They continue safely with bounded Task bootstrap until
upgraded. Historical delivery payloads are not silently rewritten.

## Alternatives

Keeping the shared Room transcript conflicts with the folder interaction.
Filtering only Web leaves model context mixed. Resetting every upgraded native
session on every request loses useful Task continuity. Copying every Task Result
into shared knowledge would recreate implicit cross-Task context.

## Consequences

Existing Room messages, Task IDs and access rights are preserved. Room reduction
history remains inspectable but is no longer an automatic Runtime input. Work
can share accepted project knowledge without sharing every discussion. A policy
transition starts a fresh native session once, rebuilt from Task-owned evidence.

## Compatibility and Security

Message filtering and Bridge capability/policy fields are additive. Legacy
Room API reads remain available; task-filtered cursors cannot cross tasks or
Rooms. No new model call or permission grant is implicit. Installed Central and
Bridge updates preserve pairing, device consent and existing data.

## Verification

Negative context fixtures must exclude foreign-task messages/checkpoints and
unaccepted, foreign-Room or future Results while retaining explicit Room Memory.
Pagination, delayed task switches, retry and live output checks must preserve
task scope. Contract and native-session checks cover policy rollover and legacy
start_new behavior, followed by disposable browser and installed local evidence.
