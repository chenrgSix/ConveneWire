# QA-082 authenticated evidence disclosure

The production goal is explicit source-owner authorization connected to real
Bridge transport and existing Result storage. See
[ADR-0056](../adr/0056-authorize-exact-evidence-disclosure.md).

Local acceptance uses two different Members and Device credentials, separately
scoped sources, a shared Task/Room and an authorized final evidence consumer.
It includes exact-content consent, private candidate retention, no raw streaming
egress, current-authority publication, revocation races and ambiguous-commit
idempotency. These checks call production entrypoints, not the QA disclosure
adapter. No external model calls or live user-data disclosure are authorized.

Human approval binds exact bytes and destination; it does not certify correctness.
Grant status, Run outcome, Result proposal and Result acceptance remain distinct.
An unavailable source remains unavailable to the final consumer.

Physical multi-owner/device acceptance and installation are separate future
evidence. Delivery state and dependencies are recorded only in TASKS.md.
