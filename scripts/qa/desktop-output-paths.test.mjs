import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const darwinScript = path.join(root, "bridge/scripts/package-desktop-darwin.sh");

test("macOS packaging keeps build and ZIP output under caller-relative, spaced and absolute directories", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "convenewire-desktop-paths-"));
  try {
    const bin = path.join(fixture, "bin");
    await mkdir(bin);
    // Compilation/plist validation and Hub payloads are fixtures. Production
    // code performs path resolution, manifest admission, staging and ZIP IO.
    await writeFile(path.join(bin, "go"), `#!/bin/sh
if [ "$1" = env ]; then
  if [ "$2" = GOHOSTOS ]; then echo darwin; else echo arm64; fi
  exit 0
fi
case "$*" in
  *cmd/convenewire-bridge-desktop*)
    case "$*" in *-extldflags=-mmacosx-version-min=12.0*) ;; *) exit 41 ;; esac
    [ "$MACOSX_DEPLOYMENT_TARGET" = 12.0 ] || exit 42
    case "$CGO_CFLAGS $CGO_CXXFLAGS $CGO_LDFLAGS" in *-mmacosx-version-min=12.0*) ;; *) exit 43 ;; esac
    ;;
  *cmd/convenewire-bridge|*cmd/convenewire-node|*cmd/convenewire-codex-desktop) ;;
  *) exit 44 ;;
esac
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then shift; target="$1"; break; fi
  shift
done
printf '#!/bin/sh\n# %s\necho %s\n' "$CW_PATH_TEST_COMMIT" "$RELEASE_TAG" > "$target"
chmod +x "$target"
`, { mode: 0o700 });
    await writeFile(path.join(bin, "plutil"), "#!/bin/sh\nif [ \"$1\" = -extract ]; then echo 12.0; fi\n", { mode: 0o700 });
    await writeFile(path.join(bin, "xcrun"), '#!/bin/sh\necho "platform MACOS"\necho "minos ${CW_PATH_TEST_MINIMUM:-12.0}"\n', { mode: 0o700 });
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const hub = path.join(fixture, "fixture hub");
    const files = [];
    for (const name of [process.platform === "win32" ? "bin/node.exe" : "bin/node", "apps/server/dist/server.js",
      "apps/server/dist/local-node.js", "apps/web/dist/index.html", "node_modules/better-sqlite3/package.json",
      "node_modules/@convene-wire/contracts/package.json", "NODE-LICENSE", "LICENSE", "NOTICE"]) {
      const file = path.join(hub, name), content = Buffer.from(`fixture ${name}\n`);
      await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content);
      files.push({ path: name, size: content.length, sha256: createHash("sha256").update(content).digest("hex") });
    }
    await writeFile(path.join(hub, "hub-manifest.json"), JSON.stringify({schemaVersion: 1, platform: process.platform,
      arch: process.arch, nodeVersion: "v22.23.1", sourceCommit: commit, sourceState: "clean", releaseVersion: "v0.0.0-path-test", files}));
    const packageName = "convenewire-bridge-desktop_0.0.0-path-test_darwin_arm64";
    for (const [index, directory] of ["dist", "nested output/dist space", path.join(fixture, "absolute output")].entries()) {
      const cwd = path.join(fixture, `caller ${index}`);
      await mkdir(cwd);
      const expected = path.resolve(cwd, directory);
      const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, OUTPUT_DIR: directory,
        RELEASE_TAG: "v0.0.0-path-test", SOURCE_REF: "HEAD", GOARCH: "arm64", CW_PATH_TEST_COMMIT: commit, LOCAL_HUB_BUNDLE: hub };
      const output = execFileSync("bash", [darwinScript], { cwd, env, encoding: "utf8" });
      // realpath handles /var -> /private/var on macOS.
      const canonical = execFileSync("pwd", ["-P"], { cwd: expected, encoding: "utf8" }).trim();
      assert.equal(output.trim().split("\n").at(-1), path.join(canonical, `${packageName}.zip`));
      const archive = path.join(expected, `${packageName}.zip`);
      const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" });
      assert.ok(entries.includes(`${packageName}/ConveneWire Bridge.app/Contents/MacOS/convenewire-bridge-desktop`));
      assert.ok(entries.includes(`${packageName}/ConveneWire Bridge.app/Contents/Resources/bin/convenewire-bridge`));
      assert.ok(entries.includes(`${packageName}/ConveneWire Bridge.app/Contents/Resources/bin/convenewire-node`));
      assert.ok(entries.includes(`${packageName}/ConveneWire Bridge.app/Contents/Resources/bin/convenewire-codex-desktop`));
      assert.ok(entries.includes(`${packageName}/ConveneWire Bridge.app/Contents/Resources/hub/hub-manifest.json`));
      for (const executable of ["MacOS/convenewire-bridge-desktop", "Resources/bin/convenewire-bridge"]) {
        const content = execFileSync("unzip", ["-p", archive, `${packageName}/ConveneWire Bridge.app/Contents/${executable}`], { encoding: "utf8" });
        assert.match(content, new RegExp(commit, "u"));
      }
      assert.deepEqual(await readdir(expected), [`${packageName}.zip`], "completed packaging leaves no discoverable app or staging directory");
      assert.throws(() => execFileSync("bash", [darwinScript], { cwd, env, stdio: "pipe" }), /output already exists/u);
      for (const wrongMinimum of ["11.0", "26.0"]) {
        assert.throws(() => execFileSync("bash", [darwinScript], { cwd, stdio: "pipe",
          env: { ...env, OUTPUT_DIR: `${directory}-${wrongMinimum}`, CW_PATH_TEST_MINIMUM: wrongMinimum }
        }), /Mach-O target does not match macOS 12.0/u);
        assert.deepEqual(await readdir(path.resolve(cwd, `${directory}-${wrongMinimum}`)), [], "failed validation cleans its partial app");
      }
    }
    await writeFile(path.join(bin, "zip"), '#!/bin/sh\nprintf partial > "$2"\nexit 46\n', { mode: 0o700 });
    const failedOutput = path.join(fixture, "failed archive");
    assert.throws(() => execFileSync("bash", [darwinScript], { cwd: fixture, stdio: "pipe",
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, OUTPUT_DIR: failedOutput,
        RELEASE_TAG: "v0.0.0-path-test", SOURCE_REF: "HEAD", GOARCH: "arm64", CW_PATH_TEST_COMMIT: commit, LOCAL_HUB_BUNDLE: hub }
    }));
    assert.deepEqual(await readdir(failedOutput), [], "failed ZIP creation publishes nothing and removes the partial archive and app");
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("macOS advertised minimum follows the pinned Go 1.26 supported floor", async () => {
  const plist = await readFile(path.join(root, "bridge/desktop/darwin/Info.plist"), "utf8");
  const module = await readFile(path.join(root, "bridge/go.mod"), "utf8");
  assert.match(module, /^go 1\.26\.\d+$/mu, "re-evaluate macOS support when the Go toolchain changes");
  assert.match(plist, /<key>LSMinimumSystemVersion<\/key>\s*<string>12\.0<\/string>/u);
});

test("Windows CI and Release execute production-expression output-path regressions", async () => {
  for (const name of ["ci.yml", "release-bridge.yml"]) {
    const source = await readFile(path.join(root, ".github/workflows", name), "utf8");
    assert.ok(source.includes("./scripts/test-windows-output-paths.ps1"));
  }
});

test("Windows upgrades replace only the managed Hub and require both Node payload components", async () => {
  const source = await readFile(path.join(root, "bridge/desktop/windows/installer.iss"), "utf8");
  const files = source.split("[Files]\n")[1].split("\n[InstallDelete]")[0];
  assert.match(files, /Source: "\{#SourceDir\}\\hub\\\*"; DestDir: "\{app\}\\hub"/u);
  assert.match(files, /Source: "\{#SourceDir\}\\convenewire-node\.exe"/u);
  assert.ok(!files.includes("#if"));
  const deletes = source.split("[InstallDelete]\n")[1].split("\n[Icons]")[0];
  const targets = deletes.split("\n").filter(line => line.startsWith("Type:"));
  assert.deepEqual(targets, [
    'Type: files; Name: "{app}\\AgentRoom Bridge.exe"',
    'Type: filesandordirs; Name: "{app}\\hub"'
  ], "upgrade must not acquire ownership of the private Node or legacy profile");
});
