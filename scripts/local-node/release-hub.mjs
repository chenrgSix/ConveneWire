import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBundleForTarget } from "./bundle.mjs";
import { assertDesktopHubIdentity } from "./desktop-bundle.mjs";

export async function verifyReleaseHub(directory, sourceCommit, releaseVersion, platform, arch) {
  const manifest = await verifyBundleForTarget(directory, platform, arch);
  assertDesktopHubIdentity(manifest, sourceCommit, releaseVersion);
  if (manifest.sourceState !== "clean") throw new Error("Distributed Hub must come from a clean source checkout");
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, sourceCommit, releaseVersion, platform, arch, ...extra] = process.argv.slice(2);
  if (!directory || !sourceCommit || !releaseVersion || !platform || !arch || extra.length) {
    throw new Error("Usage: release-hub.mjs HUB_DIRECTORY SOURCE_COMMIT RELEASE_TAG PLATFORM ARCH");
  }
  const manifest = await verifyReleaseHub(directory, sourceCommit, releaseVersion, platform, arch);
  console.log(JSON.stringify({sourceCommit: manifest.sourceCommit, releaseVersion: manifest.releaseVersion,
    platform: manifest.platform, arch: manifest.arch, files: manifest.files.length}));
}
