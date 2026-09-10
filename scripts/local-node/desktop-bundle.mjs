import path from "node:path";
import {fileURLToPath} from "node:url";
import {verifyBundle} from "./bundle.mjs";

export function assertDesktopHubIdentity(manifest, sourceCommit, releaseVersion) {
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit) || !releaseVersion || manifest.sourceCommit !== sourceCommit || manifest.releaseVersion !== releaseVersion) {
    throw new Error("Hub and desktop build identities differ");
  }
  if (manifest.sourceState !== "clean" && releaseVersion !== "v0.0.0-local") throw new Error("Release Hub must come from a clean source checkout");
}

export async function verifyDesktopHub(directory, sourceCommit, releaseVersion) {
  const manifest = await verifyBundle(directory);
  assertDesktopHubIdentity(manifest, sourceCommit, releaseVersion);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, sourceCommit, releaseVersion, ...extra] = process.argv.slice(2);
  if (!directory || !sourceCommit || !releaseVersion || extra.length) throw new Error("Usage: desktop-bundle.mjs HUB_DIRECTORY SOURCE_COMMIT RELEASE_TAG");
  const manifest = await verifyDesktopHub(directory, sourceCommit, releaseVersion);
  console.log(JSON.stringify({sourceCommit: manifest.sourceCommit, releaseVersion: manifest.releaseVersion, sourceState: manifest.sourceState, platform: manifest.platform, arch: manifest.arch}));
}
