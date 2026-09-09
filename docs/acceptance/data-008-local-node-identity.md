# DATA-008 Local Node Identity and Recovery

The Local Node increment persists an installation identity independently of
browser storage. Its Node ID, fixed local Owner, saved loopback port and private
seed are kept in an owner-only Node root. Migration 0093 binds their public
identity and seed digest to the Hub database. A missing identity in a nonempty
root, missing initialized database, mismatched seed/Owner/origin, legacy Central
database adoption and ordinary Central startup against Node data fail closed.

The private supervisor protocol has authoritative JSON Schema and generated
TypeScript/Go types. The Server accepts launch data on inherited stdin, reports
readiness with a per-launch proof and closes on EOF. The supervisor implementation
and native lifecycle acceptance belong to BRG-079.

Local entry tickets are random, memory-only, one-use and valid for two minutes.
The authenticated supervisor issues them; browser requests cannot call its
control channel. The exchange always authenticates the installation Owner and
rejects arbitrary User fields. Web removes the fragment and retains the resulting
24-hour bearer only in tab session storage. Browser reset requires reopening from
the desktop and does not change the Owner. Exact Host/Origin checks and existing
anonymous rate limits apply. Legacy local and trusted-team auth retain their
previous endpoints and behavior outside Local Node mode.

The selected local Team has one durable Device credential envelope, encrypted
with the installation seed and authenticated against its Node/Device binding.
Retries return the existing selection; another Team is refused. Revocation does
not mint another Device or credential. The public status never returns the
credential. Local consent and full trust are not granted by this binding.

Stopped-root backup preserves the identity, database and Bridge execution files
under a private destination with exhaustive SHA-256 inventory. A live lease or
saved-port listener rejects backup. Restore requires the original absent root,
refuses overwrite, unsafe paths, links, extra files and digest/identity mismatch,
and removes its own partial output after failure. This preserves absolute Bridge
configuration and Workspace meanings; it is not a portable clone or live
migration feature. Do not run a parked/restored copy concurrently.

Evidence comes from:

- [Server security/reopen tests](../../apps/server/test/local-node.test.ts): fixed
  Owner, single-use/expired tickets, browser control rejection, foreign origins,
  encrypted binding, response retry, revocation, mismatched data and SQLite backup.
- [Web entry test](../../apps/web/test/local-node-entry.test.ts): poisoned browser
  User cache, fragment removal, tab reload, browser reset and expired sessions.
- [Go data tests](../../bridge/internal/localnode/data_test.go): exclusive root,
  stable identity, stopped snapshot/restore, missing/corrupt/newer identity,
  missing initialized database, private permissions and link/tamper rejection.
- [Shared protocol fixtures](../../packages/contracts/test/fixtures/local-node.json)
  validated in both TypeScript and Go, deterministic generation and type checks.

The focused Server/Web tests, existing auth/migration regressions, full Contracts
suite, Go tests/race/vet, production builds, docs and whitespace checks are local
evidence. The snapshot Go unit fixture is not a SQLite engine test; real SQLite
backup/reopen is covered separately by the Server test. Windows native storage,
installed-client acceptance, real Runtime/model calls, CI and publication remain
separate gates.
