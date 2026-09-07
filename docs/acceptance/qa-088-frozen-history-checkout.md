# QA-088: Retain frozen Git evidence during repository verification

CI `34101498615` on `8ee7d33` passed Go and both native Desktop jobs, and all
Server/Web/contract tests. Its later offline workspace-evidence test failed at
`git show 196032b8877be460ea1806065f2e81bd4949e117:bridge/internal/runtime/assessment.go`.
The action's default depth-one checkout omitted historical source objects that
the frozen packet must verify. The same full `npm test` passed locally with a
complete Git history. Delivery state lives only in [TASKS.md](../TASKS.md).

The CI Repository job and protected Release repository-gates job must request
`fetch-depth: 0`. The Release still checks out its initially resolved exact SHA;
other jobs retain their existing source binding and history scope. No source
excerpt, journal, rubric, invocation budget or live-model permission changes.

Validate by reproducing the frozen-source failure in a disposable depth-one
clone, fetching its missing history, then passing the unchanged frozen-source
test. Run the existing Release workflow policy regressions and documentation
checks. Exact-source hosted CI remains QA-086's separate pre-tag gate.

The disposable clone reproduced the lookup failure before fetching history and
passed the unchanged test afterward, including each full-source SHA-256 and exact
excerpt comparison. The clone was physically removed. All 23 existing Release
workflow policy tests and 435-document lint passed. Only the two repository-gate
checkouts gained history; the resolved Release `ref` remains unchanged.
