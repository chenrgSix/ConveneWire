# BRG-088: Windows Room and Agent theme synchronization

## Cause and correction

The Room changed its `data-theme` attribute, but never loaded the shared native
navigation observer. Wails URL windows on Windows do not execute the configured
injection, leaving the desktop's remembered appearance at its default `dark`.
BRG-087 had repaired script loading for the Console only.

The Web entry now imports the same navigation file used by the Console and
embedded desktop. Vite includes it in the production bundle before React restores
the saved appearance. Initial appearance and subsequent changes use the existing
closed light/dark events; the native settings URL and authorization are unchanged.
The existing per-document guard handles duplicate macOS injection, and ordinary
browsers have no native message port. No new endpoint or privileged API is added.

The old local-node navigation test now reads the shared script instead of trying
to extract a removed Go string constant.

## Verification

- Three new regression cases fail against the original Web entry and pass with
  the import. They cover both platform ports, initial/restored appearance,
  light/dark toggles, fresh Room documents after return, duplicate injection,
  native settings presentation, invalid values and ordinary browsers.
- The focused navigation/settings suite passes 14 tests.
- All 104 embedded UI tests plus four local-node navigation tests pass using
  `node scripts/test/run-with-temp-root.mjs -- node --test bridge/internal/console/*.test.mjs scripts/local-node/native-space-navigation.test.mjs`.
  The npm wrapper's nested npm launch fails with Windows `spawn EINVAL`; the
  direct Node command retains the same temporary-root wrapper and test files.
- `npm run build --workspace @convene-wire/web` passes TypeScript and Vite.
  The generated production entry contains the shared navigation guard/observer.
  This isolated checkout needed its own dependencies: normal `npm ci` failed on
  the unrelated SQLite native build because Python was unavailable;
  `npm ci --ignore-scripts` supplies the locked dependencies needed for these
  frontend checks. No Server/SQLite test result is claimed.
- Six Web onboarding/visual-system checks pass, including the actual React theme
  button and saved light/dark preference.
- Native Windows desktop tests pass with Go 1.26.7 using a workspace-owned
  temporary root. The initial default `C:\Windows\Temp` root failed private-file
  ACL checks; moving only disposable fixtures to the workspace resolves them.
  `GOPROXY=https://goproxy.cn` was used after the default proxy timed out.
- Desktop/Console `go vet -tags desktop` and the changed Go file's `gofmt` check
  pass with the same isolated fixture/cache setup.
- Documentation lint passes; whitespace and changed-document links are checked.

These are local automated checks. The installed application has not been replaced
or restarted, and no owner Room, model invocation or physical desktop appearance
acceptance is claimed. Deployment must include the rebuilt Web assets in the
Local Hub bundle; replacing only the Go executable cannot activate this fix.
