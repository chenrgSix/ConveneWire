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
