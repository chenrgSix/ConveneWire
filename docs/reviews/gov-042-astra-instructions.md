# Project Instruction Review for GPT-6 Astra

Reviewed on 2026-09-07. Delivery status belongs only to
[GOV-042 in the task register](../TASKS.md).

## Sources and reading limits

The full official [GPT-6 Astra model guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra)
was read from its official Markdown representation, including introduction,
features, prompting guidance and migration notes. The relevant recommendations
are explicit completion, scoped autonomy, instruction-conflict diagnosis,
task-appropriate verification and intentional delegation policy. API migration
settings are outside this project-instruction change.

Eric Provencher's [Rethinking skills and prompts for GPT-6 Astra](https://x.com/pvncher/status/2095991462416490862)
was published on 2026-09-04. X returned HTTP 403; all article text blocks were
read through the public [FxTwitter article response](https://api.fxtwitter.com/pvncher/status/2095991462416490862),
which identifies the author, title and original article ID
`2095989703967125509`. This is a third-party retrieval of the original text,
not direct authenticated X access. Two embedded example images could not be
opened; their captions were available, but the image contents were not verified.
The text supports narrow skill triggers, progressive disclosure, contextual
repository reading and retaining only decision boundaries the task needs.

## Effective scope

The project has one root `AGENTS.md`; no project `SKILL.md`, nested
`AGENTS.md`/`AGENTS.override.md`, `.agents/` or `.codex/` instruction directory
was found. `CONTRIBUTING.md`, the task register and the module index supply
the linked repository policies. Runtime prompt implementation and historical
experiment packets are product/evidence surfaces, not instructions governing
this coding session.

The user's final scope is this project only. Global instructions, installed
skills, model settings and memories were not changed. App-provided instructions
are outside the repository and cannot be rewritten by these files. No new skill
was created merely to duplicate the repository guide. The existing session
delegation policy remains in force; this review did not launch subagents.

## Changes and preserved boundaries

| Surface | Finding | Change |
| --- | --- | --- |
| Root `AGENTS.md` | Long command catalog loaded for every task | Keep common constraints and route to seven sections in the command reference |
| `CONTRIBUTING.md` | Every edit required reading the architecture baseline | Read affected material; consult baseline and ADRs when architecture or authority is relevant |
| Completion guidance | First implementation could become an implicit stopping point | Continue through relevant checks, change-caused repairs, task evidence and local commit |
| Verification guidance | No explicit stopping rule for small changes | Scope checks to the affected surface; expand only for new evidence or required gates |
| Skill guidance | Global skills may carry workflows unrelated to this project task | Load relevant guidance and explain an actual conflicting rule; preserve higher-priority constraints |

All 80 original command entries and their attached boundaries move to
[Development and Operations Commands](../development-commands.md), with the
relative Discussion-guide link adjusted for the new location. Command strings
and executable behavior are unchanged. Example release tags and dates are
identified as historical or placeholder inputs.

Task IDs, dependency checks, same-commit task updates, evidence before `DONE`,
required module/ADR changes, focused behavioral regressions, protocol interop,
negative security cases, race checks, owner consent and closed experiment
budgets remain required. The immutable v0.1 baseline and historical evidence
remain intact. No product module contract or product acceptance gate changes.

## Validation scope

Validation covers Markdown lint, changed-document local links and anchors,
whitespace, preservation of all moved command entries, and the diff's exclusive
documentation scope. Runtime suites and real model calls are unnecessary for
this documentation-only change. These checks establish instruction consistency
and reference integrity, not a measured improvement in model behavior.

`npm run lint:docs` passed across 421 Markdown files. All 19 local links and
anchors in the four instruction/reference documents resolved, and all 80 old
command entries were present exactly once with their scope text preserved.
`git diff --check` passed. Root `AGENTS.md` decreased from 20,853 to 5,206 bytes,
about 75 percent. A task-register comparison confirmed that GOV-042 is the only
added ID and its GOV-003 dependency is `DONE`; the pre-existing repeated
BRG-051 row was left untouched.
