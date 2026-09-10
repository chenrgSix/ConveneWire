# WEB-087: unified native workspace

[ADR-0069](../adr/0069-unify-native-workspace-navigation.md) implements the owner's
request to remove the second-client feeling from local Agent setup. The packaged
desktop now starts in the local workspace even with a retained remote profile.
Agent settings replace the content of the same native window, open directly on
the Agent list, and return through a fixed native action. Runtime, Agent editing,
Peer management and policy validation still belong to the original native service.
Console credentials remain separate from Hub credentials; no privileged iframe
or Hub proxy was introduced. Explicit Bridge compatibility remains available.

## Verified implementation

Code commits `f8675854` and `beb0f148` deliver the window/startup change and align
the settings palette with the workspace's `visual-system.css`. The old sidebar,
second native window and ordinary `Open local Console` label are removed from
Local Node navigation. Both appearance modes and the credential-free settings
address survive subsequent navigation. Existing native editors and controls are
retained, with product language describing the local running service.

All 92 embedded UI tests, 12 affected Web tests, four WebKit/WebView2 navigation
script tests, native desktop race/vet, the final focused native race repeat,
Web build, docs lint, local links and whitespace checks pass. The Web scenarios
include the real App/Local Node HTTP onboarding flow and explicit Team binding.
An isolated actual native Owner service also opened the Agent list and editor;
it saved no Agent, ran no Runtime probe and cleaned its private fixture.

## Actual installed result

The final clean source is `beb0f148d12378075761e68f963f5d399fab2562`.
The archive is
`dist/local-node-web087-beb0f148/convenewire-bridge-desktop_0.0.0-local_darwin_arm64.zip`.
Its SHA-256 is
`d6d66ee51ddd07b387231466491764382a8e3dacf5d9f5f7a662f71f5090b7f8`.
ZIP paths, all 6,215 extracted Hub files, native source/version/target and the
installed desktop/Hub digests were checked. Packaging verifies the bundled
Node/SQLite runtime with an empty executable search path.

The owner-authorized update retained the old application and a stopped Node
snapshot in the private owner profile. Ordinary launch, without `--hub-bundle`,
`--node-data` or `--bridge-only`, opened the original local Team. Actual native
clicks opened the Agent list and returned to that Team in one main window.
[Dark settings](evidence/web087/native-agent-settings-dark.jpg) and
[light settings](evidence/web087/native-agent-settings-light.jpg) show the
workspace colors; the original dark preference was restored afterward.
The settings remained on the same surface after a refresh gesture, and its
visible address contained no control token. Exactly one desktop process owns
one bundled Hub process. The application is left running for the owner.

[Sanitized assertions](evidence/web087/native-workspace.json) record preservation
of the legacy profile, Node identity, Agent configuration and completed Run
references/states. While the update was being checked, the owner independently
created an Agent and completed a Run. The final update waited for completion,
backed up that current state and preserved it. This owner activity is not
reported as an automated model test; automation made zero provider invocations.

This closes the requested local UI/startup change. Physical Windows, minimum-OS
hardware, independent human owners, remote CI and publication were not exercised.
Those broader gates remain in [QA-092](qa-092-ab-native-desktop.md).
