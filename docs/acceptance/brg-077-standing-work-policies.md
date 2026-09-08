# BRG-077 standing work policy evidence

Date: 2026-09-08. Scope: owner-local repository policy storage and exact grant
derivation under [ADR-0060](../adr/0060-preauthorize-local-work-policies.md).

One immutable policy can derive grants for two distinct Tasks. Each grant pins
its policy, authenticated authorization operation, initiator, Task and plan
revisions, source commit, profiles, paths, operations and finite limits. The
operation fixes the grant identity before plan compilation; a changed request
under that identity conflicts. Reopening the store preserves exact replay.
Parent revocation invalidates existing grants and subsequent derivation.

The fixtures use disposable physical SHA-1 and SHA-256 Git repositories.
Negative cases cover changed initiators, source, profiles, scope, limits,
expiry, overlapping policies, symbolic source refs, owner substitution,
unknown/duplicate JSON fields and immutable-record tampering. Concurrent
duplicate derivations produce one grant. Fractional timestamps are compared as
instants rather than lexicographically.

## Verification

- `node scripts/test/run-with-temp-root.mjs --cwd bridge -- go test -race ./internal/repository`
  passed (498.738 seconds).
- After the final authorization-identity and timestamp changes,
  `node scripts/test/run-with-temp-root.mjs --cwd bridge -- sh -c 'go test -race ./internal/repository -run "TestWorkPolicy|TestTaskGrant" -count=1 && go vet ./internal/repository'`
  passed (focused package tests: 34.899 seconds; vet: no diagnostics).
- Changed-document lint, relative links and `git diff --check` passed.

## Evidence boundary

This verifies the local authority library. Authenticated Central negotiation,
Room admission, policy setup UI, active-process cancellation and browser
verification remain tracked by the dependent Tasks in
[the task register](../TASKS.md#preauthorized-everyday-development). This evidence
does not establish an unattended product flow, a supported installed Runtime,
live model execution, CI or physical-platform acceptance.
