# BRG-089: Reviewed Peer task session resume capability

## Cause and correction

The native sharing controller omitted `supportsResume` from its capability
choices and always exported `false`, even when the local adapter supported
resume. The existing Host admission policy consequently selected `start_new`
for ordinary Task runs. This sharing code is common to Windows and macOS;
the observed macOS configuration difference has not been verified.

The sharing form now offers **恢复同一任务会话** for capable sources, initially
checked with an explicit opt-out before review. Confirmation lists the selected
capability, freezes it and retains identical request bytes on an ambiguous
retry. Selected capabilities are bounded by the actual source capability set;
an injected checkbox cannot enable resume on an unsupported source.

The inventory displays local resume consent and tells owners how to update an
existing disabled share. It does not migrate saved Export or Host Acceptance
records. Owners must explicitly reshare with resume enabled and the Host must
accept the new version. The existing Host acceptance flow preserves the offered
capabilities. Ordinary runs then use the existing `resume_or_start` policy;
Discussion turns continue to use fresh sessions. There is no wire, execution
permission, admission or persistence change.

## Verification

- Four focused regression cases cover capable sources, opt-out, unsupported
  sources and existing disabled shares. Before the correction, the sharing
  suite had three failures from the missing choice/update hint; after the
  correction, all 13 tests pass:
  `node scripts/test/run-with-temp-root.mjs -- node --test bridge/internal/console/peer-sharing.test.mjs`.
- All 108 embedded UI tests pass:
  `node scripts/test/run-with-temp-root.mjs -- node --test bridge/internal/console/*.test.mjs`.
- The existing Host panel suite passes eight tests, including explicit
  acceptance review, stale-offer rejection and exact lost-response retry:
  `node scripts/test/run-with-temp-root.mjs --cwd apps/web -- node --import tsx --test test/peer-host-panel.test.tsx`.
  Invoking `tsx` directly outside npm initially failed with `ENOENT`; loading
  the installed package through Node runs the suite without adding dependencies.
- `node --check bridge/internal/console/static/peer-sharing.mjs`,
  documentation lint, changed-document links and `git diff --check` pass.

These are automated local interface checks. No real model invocation or physical
desktop acceptance is claimed. The installed Bridge has not been replaced or
restarted, and existing live authorization remains unchanged. Activation requires
a rebuilt Bridge containing the updated embedded assets, followed by explicit
resharing and Host acceptance.
