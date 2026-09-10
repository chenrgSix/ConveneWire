# ADR-0069: Unify native workspace navigation

- Status: Accepted
- Date: 2026-09-10
- Task: WEB-087
- Extends: ADR-0066, ADR-0068

## Context

The owner requested one desktop entry and an integrated local Agent experience
after the installed Node-first application still opened the old Console window.
Retaining a remote profile also made an ordinary relaunch select the old interface.

## Decision

A packaged desktop with a Hub defaults to the local workspace, even when a legacy
remote profile exists. The profile remains untouched; it is not rebound, imported
or started alongside the local Runtime. Explicit `--bridge-only` and Device pairing
launches retain the compatibility entry. Unbundled Bridge builds remain supported.

Local Agent management uses a settings surface in the single main native window.
It opens directly on the Agent list with workspace navigation, consistent styling
and an explicit return action. Agent editing, local policies, Peer connections and
Runtime controls continue to use the existing native Owner service and validators.
The second Console window is removed from Local Node mode.

## Compatibility and security

The Hub and native Owner service retain their separate origins and capabilities.
The settings surface is a top-level native navigation, not an iframe or a proxy
for privileged native APIs through the Hub. Console bearer tokens are never sent
to the Hub. The return event has no page-supplied URL or credential; the supervisor
issues the current installation's fresh entry. Existing authentication and framing
restrictions remain in force. Returning to work does not stop the Runtime or Hub.

## Verification

Cover packaged launch with absent and existing profiles, explicit compatibility,
one-window navigation, credential-free return events, native settings versus
legacy rendering, Agent editing and explicit Team binding. Verify the packaged
application by normal launch, settings entry, return and relaunch on this Mac.
Local installation does not establish Windows, independent-owner or live-model
acceptance. The task register alone records delivery status.
