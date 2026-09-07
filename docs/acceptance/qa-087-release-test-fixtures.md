# QA-087: Repair release test fixtures

CI `34099885604` on `97f967f` failed eight Server migration fixtures and one Web
Task-copy test. Delivery state belongs in [TASKS.md](../TASKS.md); these failures
block QA-086 source selection even though focused disclosure/physical tests pass.

Migration `0088_evidence_disclosure.sql` was added by SEC-015, while legacy tests
still expected the final version to be 87. The scheduler backfill fixture also
removed only versions 81 through 87 before testing the isolated version-81
migration, leaving an unknown version 88 entry. Preserve exact version history,
legacy row/foreign-key/rollback checks and the production unknown-version guard;
correct only the explicit test expectations and historical fixture setup.

The Web failure is a queued React scheduler callback reading `window` after the
Task-copy fixture restores JSDOM globals. Teardown must await React cleanup while
the DOM remains available. Preserve the actual server-backed copy, lost-response,
session-switch and independent-draft assertions; do not suppress uncaught errors
or add arbitrary sleeps.

Run the affected migration/backfill and Task-copy regressions, then the complete
workspace gate. Exact-source hosted CI remains a separate QA-086 admission gate.

## Implemented Repair And Local Evidence

Explicit migration history/count assertions now include version 88. The legacy
schema comparison accounts for the newly introduced disclosure table and index;
the isolated scheduler fixture removes the version-88 metadata together with its
other post-baseline test metadata. Production migrations, integrity checks and
the rejection of unknown versions remain unchanged. This fixture reconstruction
is not an operator rollback procedure.

Task-copy teardown now awaits `act` around React cleanup before restoring globals
or closing JSDOM. It neither catches the prior uncaught exception nor changes
the copy behavior, assertions or timeout.

Fourteen focused migration/backfill tests and all seven server-backed Task-copy
tests pass without skips. The full workspace run passes 649 Server tests, 313
Web tests and 115 contract tests, plus Web typechecking and generated contract
checks. Historical data, foreign keys, failed-migration rollback, copy allowlist,
response-loss handling and session-switch assertions remain exercised.

The first local combined Server/Web invocation used the repository-root TSX
configuration and therefore produced six `React is not defined` runner errors;
the Web tests were rerun from their actual workspace, as the committed npm script
requires. A first migration rerun also exposed the missing disclosure schema
objects in the legacy comparison; both are corrected above. Neither attempt is
reported as a pass. The broader release gate remains in QA-086.
