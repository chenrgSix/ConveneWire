# QA-091: Node-first V1 automated acceptance

The automated Node-first V1 gate passed against the implementation recorded in
`41cd563fb983f80f70ae1fd9a34a8552df9b7484`. Milestones A/B/C implementation and
their automated checks are complete. [TASKS.md](../TASKS.md) owns delivery state;
[QA-092](qa-092-ab-native-desktop.md) owns the remaining combined manual and
physical acceptance. No installation, external publication or model call was
performed by this gate.

## Scenario evidence

The original N1-N8 scenarios are mapped below to actual executable coverage.
All Hosts, TLS identities, credentials, Runtime executables and data used here
belong to disposable local fixtures. Several independently authenticated Hosts
on one computer do not constitute independent physical owners or machines.

| Scenario | Executable evidence and observed result |
| --- | --- |
| N1: local Codex/Pi collaboration | The [bundled native Node test](../../scripts/local-node/supervisor.test.mjs) configures Codex and Pi through the Console, completes an ordinary Run, two-Agent Discussion and one Finalizer, then restarts and restores unchanged identity and completed records without replay. Its [offline executable](../../scripts/local-node/fixtures/offline-runtime.go) implements both real adapter protocols, and the invocation journal must contain both Runtime kinds. No provider or physical-airgap claim follows. |
| N2: one-use invitation and Room ceiling | [Actual Go/TLS admission](../../bridge/internal/peer/client_interop_test.go) recovers a lost claim response. [Server admission](../../apps/server/test/peer-admission-service.test.ts) rejects changed recipients/proofs and preserves atomic claim/retry; [human authority](../../apps/server/test/peer-human-authority.test.ts) fences Team inventory, counts, search, events and foreign Rooms. Human entry and machine authority remain separate. |
| N3: bilateral Agent sharing | [Host offer/acceptance](../../apps/server/test/peer-agent-service.test.ts) creates no Agent from an offer alone and checks exact reviewed scope. [Native connectors](../../bridge/internal/peer/connectors_test.go) synchronize separate signed histories with two actual TLS Hosts and isolate revocation. Changed offers and retired lineages cannot restore previous acceptance. |
| N4: one Host owns mixed Discussion | [Peer Discussion](../../bridge/internal/peer/discussion_execution_test.go) uses the real Host API and native Pi adapter for the remote contribution and Finalizer. Its local Host contributor is an offline adapter. [Server Discussion cases](../../apps/server/test/peer-discussion.test.ts) cover mixed Device/Peer eligibility, frozen inputs, private/quorum negatives, cancellation and one finalization. |
| N5: Participant death without replay | [Abrupt process crash](../../bridge/internal/peer/run_worker_crash_test.go) kills a separate Participant process and fences possible-start/orphan evidence before one unknown settlement. [Connection/core recovery](../../bridge/internal/peer/run_worker_recovery_test.go) retains the same execution identity across lost sockets, Host reopen and Participant replacement. |
| N6: Host restart during a partial Wave | The native [Discussion test](../../bridge/internal/peer/discussion_execution_test.go) reopens the actual Host service/database with one completed contribution and one pending Peer Turn. Wave, Turn and Run identities and the open barrier survive. A second reopen precedes frozen Finalizer delivery; the result contains two Waves, three Turns and exactly two native remote starts. This is service/database reopen, not an OS power-loss test. |
| N7: revoke without restoring business rights | [Human sessions](../../apps/server/test/peer-human-authority.test.ts), [Agent projection](../../apps/server/test/peer-agent-projection.test.ts), [Run admission](../../apps/server/test/peer-run-authority.test.ts) and [ordered delivery/settlement](../../apps/server/test/peer-run-delivery.test.ts) deny revoked content, new work and publication. [Native execution](../../bridge/internal/peer/run_execution_test.go) separates stopped-process settlement from revoked business authority; an old receipt cannot restore membership. |
| N8: credential, Session and disclosure isolation | [Runtime binding](../../bridge/internal/peer/runtime_factory_test.go) rejects missing, changed or inherited authority; [local approval](../../bridge/internal/peer/approvals_test.go) is exact, expiring and revalidated after waiting. [Two-Host execution](../../bridge/internal/peer/run_worker_hosts_test.go) keeps colliding IDs and journals separate while sharing one physical Workspace gate. Native event projection keeps Session identity private and redacts sensitive nested output. Under [ADR-0065](../adr/0065-node-first-authority-model.md), this does not establish a universal sandbox against an arbitrary Runtime with the local OS user's privileges. |

## Completed checks

[Machine-readable results](evidence/qa091/automated-checks.json) retain the final
source and distinguish new combined checks from earlier module checks:

- Full Server regression: 822 passed, zero failures, one opt-in browser-preview
  test skipped; 308.34 s. The skipped preview is not counted as manual acceptance.
- Native bundled Codex/Pi Run/Discussion, network staging/activation and
  restart/restore: passed in 22.25 s. Standalone offline Runtime vet passed.
- Native partial-Wave/Finalizer recovery: focused race test passed in 16.16 s;
  Peer vet passed. The preceding complete Peer race suite passed in 342.54 s;
  its eight-delivery/shared-Workspace case also passed two race repetitions.
- Retained WEB-085 evidence: full Web 361/361 plus six final affected checks,
  and embedded Console UI 89/89. OPS-020 retains 5/5 bundle negatives and
  30/30 native distribution policy/path checks. Unchanged suites were not
  rerun merely to relabel their evidence as a new source run.
- Fresh Server/Web production build and final native package verification
  passed. Documentation lint, changed local links and whitespace checks passed.

Fixtures drained their child processes and removed their owned temporary roots.
The final archive and sanitized evidence remain; credentials, private profiles
and Runtime journals are not copied into this record.

## Final local package

The clean-source unsigned macOS arm64 artifact is
`dist/local-node-qa091-41cd563f/convenewire-bridge-desktop_0.0.0-local_darwin_arm64.zip`.
It is 75,961,053 bytes with SHA-256
`8fdd717fa7ccd67f5edc2558b9ba04759737e72632e33b2b5edbf3a0cdb85a7b`.
[Package evidence](evidence/qa091/native-package.json) records the exact source,
manifest digest, versions and checks.

The actual ZIP passed unsafe-path preflight and complete extracted inventory
verification for all 6,215 Hub files. Desktop, legacy CLI and Node host report
`v0.0.0-local`, contain the same source commit and are arm64 Mach-O binaries.
Packaging checked emitted macOS target metadata. Bundled Node 22.23.1 and native
SQLite execute with an empty PATH. The extraction was removed after verification.
Later evidence-only commits do not change this archive's source identity.

The CI/release jobs are implemented, but were not executed remotely here.
Windows native installation/upgrade, minimum-OS hardware, live providers and
publication remain separate gates. The older A/B archive in QA-092 is historical
evidence and is not the final V1 artifact above.
