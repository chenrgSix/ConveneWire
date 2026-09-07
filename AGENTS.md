# Repository Guidelines

## Task scope and completion

For implementation requests, carry the authorized change through implementation,
relevant verification, task evidence and a local commit. Fix failures caused by
that change and rerun affected checks. A first draft or a plan is not completion.
For review or analysis requests, remain read-only unless changes are requested.

Use the user's request and prior decisions to resolve routine choices. Ask when
missing information changes scope, correctness or authority; continue independent
work while waiting. Existing authorization carries forward within its scope.
Real installations, external publication, owner consent and model budgets retain
their specific gates; a local development request does not grant those actions.

Use skills only for the requested capability and load their relevant references
as needed. User instructions take precedence over skill guidelines, within the
applicable system and tool constraints. If a file instruction blocks authorized
work, identify the exact file and rule and explain the unresolved decision.

## Repository context

Read files and documentation relevant to the change; expand context when a
concrete dependency or uncertainty warrants it. A small edit does not require
reading the whole architecture or mapping the repository.

- [CONTRIBUTING.md](CONTRIBUTING.md) defines contributor policy.
- [Module index](docs/modules/README.md) routes ownership and records design
  authority: accepted ADRs, then the v0.2 baseline, then module documents.
- [Architecture baseline](convenewire_network_design_v0.2.md) and
  [ADRs](docs/adr/README.md) guide architectural changes.
  `agent_room_network_design_v0.1.md` is immutable historical context.
- [Task register](docs/TASKS.md) alone records delivery status. Inspect current
  implementation and evidence before claiming that a designed capability exists.

The Server owns Team state, MCP and routing in `apps/server/`; the browser UI is
in `apps/web/`; authoritative JSON Schema is in `packages/contracts/`; the Go
runtime Bridge is in `bridge/`; black-box scenarios are in `tests/e2e/`.
Do not scaffold a module before its milestone starts.

## Task register

Before implementation, select or add a stable task ID in `docs/TASKS.md` and
verify its dependencies. A commit that starts or completes work must update the
task state in the same commit. Mark work `DONE` only when its listed completion
evidence exists. Contract, scope, ownership or acceptance changes also update
the owning file under `docs/modules/`. Do not create a second delivery checklist.

## Commands and verification

Node.js 22 and Go 1.26.7 are required. Build, run, format, test, packaging and
owner-operation commands live in the relevant sections of
[Development and Operations Commands](docs/development-commands.md). Update that
reference when adding module commands; do not preload unrelated procedures.

Choose checks for the affected behavior and required acceptance gates:

- Documentation-only edits: `npm run lint:docs`, local link checks for changed
  documents and `git diff --check`. Runtime suites are unnecessary unless an
  executable example, contract or behavior changes.
- Behavioral edits: focused regression tests. Protocol changes require
  TypeScript and Go contract tests plus interoperability coverage. Routing
  changes cover offline, retry, duplicate, cancellation and out-of-order events.
  Security changes require a negative test.
- Go changes: `gofmt` and the owning module's test/vet commands; concurrency-
  sensitive packages also require `go test -race`.

For relevant local tests with disposable fixtures and no external model or
production access, run, repair change-caused failures and rerun without repeated
approval. Use the repository temporary-root wrappers where provided. Once the
required checks pass, expand testing only for a new change, failure or unresolved
risk. Report the checks actually run; local tests, CI, physical-platform evidence
and production acceptance remain distinct.

Historical `bench:discussion*` and frozen experiment commands are not routine
tests or reusable permission. New real model calls, including live Runtime E2E,
require their applicable bounded authorization. Read
[Discussion maintenance and evidence](docs/discussion-usage-guide.md#维护与后续验证)
when working on these paths; preserve consumed journals and historical evidence.

## Style and delivery

Follow `.editorconfig`. TypeScript uses strict mode and two spaces; Go uses
`gofmt`. Use PascalCase for domain types, camelCase for JSON fields,
lowercase dot-separated event names and lowercase namespaced MCP tools.
JSON Schema is the cross-language wire source of truth.

Commit each completed logical change with a short, imperative Conventional
Commit subject. Preserve unrelated user edits and never use `--no-verify`.
For PRs, follow `CONTRIBUTING.md` for ownership, compatibility, security and
verification evidence, screenshots for UI changes and protocol payload examples.

Lead the final response with the result, relevant verification, remaining limits
and commit. Use concise prose; use lists or tables when they help comparison.
