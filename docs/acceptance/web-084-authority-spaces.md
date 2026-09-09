# WEB-084: Authority-bound Space navigation

[ADR-0067](../adr/0067-multi-authority-runtime-foundation.md) and
[the task register](../TASKS.md) define the boundary and delivery state.

The shared Go core writes an owner-private, atomically replaced directory after
fresh Host proof. Entries contain only Authority ID, Team ID, label, kind and the
signed browser origin. Startup clears observations from the previous core;
unavailable Hosts reappear after a valid proof. Entries are navigation references,
not online status, membership or execution permission.

The Local Hub exposes the bounded generated directory only to its local Owner.
It rejects unsafe files, extra fields, oversized content, duplicate identity,
conflicting origin aliases, hosted/remote identity confusion and noncanonical or
insecure remote addresses. No Device bearer, signing key, callback or Host records
are returned. Legacy local Servers with no configured browser origin are omitted.

Web polls the local reference endpoint while the local Owner session is current.
Remote links open a separate top-level origin with `noopener`, `noreferrer` and
no-referrer policy. The only navigation parameter is the selected Team. Human
login, navigation, drafts and pending requests belong to the destination Host;
no local bearer or machine credential is forwarded. A session replacement hides
previous links immediately; late responses cannot replace the current directory.

## Verification

- Two Server Space cases and both Local Node identity/access regressions pass.
- Four Web cases pass: URL rejection, actual rendered link attributes, local-only
  fetches, session replacement, late responses, explicit Team binding and entry.
- Go Authority/bridgecore race and vet pass, including concurrent private directory
  writes and refusal of unauthenticated references.
- Three actual Hosts (one Local Hub, two separately authenticated Central Hosts)
  advertise their signed browser references through the real Go core and Local
  Owner endpoint. The full collision/queue/revoke/offline/crash scenario passes.
- Production Server/Web builds and the packaged Local Node Run/Discussion,
  restart and stopped restore regression pass with zero external model calls.

Native WebView rendering and external-window behavior are recorded by QA-092.
No Peer feature, general cross-origin API client, real installation or publication
is included in this task.
