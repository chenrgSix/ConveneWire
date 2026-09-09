import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBundle } from "./bundle.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
if (!["darwin", "win32"].includes(process.platform)) throw new Error("Local Node desktop packaging requires native macOS or Windows");
const output = path.resolve(process.argv[2] ?? "dist/local-node-desktop");
const release = process.env.RELEASE_TAG ?? "v0.0.0-local";
await mkdir(output, { recursive: true });
const work = await mkdtemp(path.join(os.tmpdir(), "convenewire-local-node-package-"));
try {
  const bundle = path.join(work, "hub");
  await buildBundle(bundle, { releaseVersion: release, nodeLicense: process.env.CONVENE_WIRE_NODE_LICENSE });
  const env = { ...process.env, LOCAL_HUB_BUNDLE: bundle, OUTPUT_DIR: output, RELEASE_TAG: release, SOURCE_REF: "HEAD", GOARCH: process.arch === "x64" ? "amd64" : process.arch };
  if (process.platform === "darwin") execFileSync("bash", [path.join(root, "bridge/scripts/package-desktop-darwin.sh")], { env, stdio: "inherit" });
  else execFileSync("powershell.exe", ["-NoProfile", "-File", path.join(root, "bridge/scripts/package-desktop-windows.ps1")], { env, stdio: "inherit" });
} finally { await rm(work, { recursive: true, force: true }); }
