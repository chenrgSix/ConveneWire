import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const manifestName = "hub-manifest.json";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const safePath = (value) => typeof value === "string" && value.length > 0 && !value.includes("\\") &&
  !value.includes(":") && !value.startsWith("/") && value.split("/").every((part) => part && part !== "." && part !== "..");

async function inventory(root, relative = "") {
  const files = [];
  for (const name of (await readdir(path.join(root, relative))).sort()) {
    const key = relative ? `${relative}/${name}` : name;
    const stat = await lstat(path.join(root, key));
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`Unsupported bundle entry: ${key}`);
    if (stat.isDirectory()) files.push(...await inventory(root, key));
    else if (key !== manifestName) files.push({ path: key, size: stat.size, sha256: digest(await readFile(path.join(root, key))) });
  }
  return files;
}

export async function verifyBundle(root) {
  const raw = await readFile(path.join(root, manifestName));
  const manifest = JSON.parse(raw);
  if (Object.keys(manifest).sort().join() !== "arch,files,nodeVersion,platform,schemaVersion,sourceCommit,sourceState" ||
      manifest.schemaVersion !== 1 || manifest.platform !== process.platform || manifest.arch !== process.arch ||
      !/^v22\.\d+\.\d+$/u.test(manifest.nodeVersion) || !/^[a-f0-9]{40}$/u.test(manifest.sourceCommit) ||
      !["clean", "modified"].includes(manifest.sourceState) || !Array.isArray(manifest.files) || manifest.files.length < 1) throw new Error("Invalid or incompatible Hub manifest");
  const seen = new Set();
  for (const entry of manifest.files) {
    if (Object.keys(entry).sort().join() !== "path,sha256,size" || !safePath(entry.path) || entry.path === manifestName || seen.has(entry.path) ||
        !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/u.test(entry.sha256)) throw new Error("Invalid Hub file manifest");
    seen.add(entry.path);
  }
  for (const required of [process.platform === "win32" ? "bin/node.exe" : "bin/node", "apps/server/dist/server.js", "apps/web/dist/index.html",
    "node_modules/better-sqlite3/package.json", "node_modules/@convene-wire/contracts/package.json", "NODE-LICENSE", "LICENSE", "NOTICE"]) {
    if (!seen.has(required)) throw new Error(`Missing Hub runtime file: ${required}`);
  }
  const actual = await inventory(root);
  const expected = new Map(manifest.files.map((entry) => [entry.path, entry]));
  if (actual.length !== expected.size || actual.some((entry) => {
    const recorded = expected.get(entry.path);
    return !recorded || recorded.size !== entry.size || recorded.sha256 !== entry.sha256;
  })) throw new Error("Hub bundle file inventory or digest mismatch");
  return { ...manifest, manifestSha256: digest(raw) };
}

async function copyTree(source, target, exclude = () => false) {
  const stat = await lstat(source);
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`Unsupported source entry: ${source}`);
  if (exclude(source)) return;
  if (stat.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const name of await readdir(source)) await copyTree(path.join(source, name), path.join(target, name), exclude);
  } else {
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    await chmod(target, (stat.mode & 0o111) ? 0o755 : 0o644);
  }
}

// Resolve the locked production dependency graph without npm, a registry fetch,
// workspace links, .bin shims, or development dependencies in the output.
function productionPackages(lock) {
  const result = new Map();
  const pending = ["apps/server", "packages/contracts"];
  const visited = new Set();
  while (pending.length) {
    const key = pending.pop();
    if (visited.has(key)) continue;
    visited.add(key);
    const entry = lock.packages[key];
    if (!entry) throw new Error(`Missing locked package: ${key}`);
    if (key.includes("node_modules/")) result.set(key, entry);
    for (const [name] of Object.entries({ ...entry.dependencies, ...entry.optionalDependencies })) {
      let parent = key;
      let found;
      while (true) {
        const candidate = path.posix.join(parent, "node_modules", name);
        if (lock.packages[candidate]) { found = candidate; break; }
        if (!parent || parent === ".") break;
        parent = path.posix.dirname(parent);
        if (parent === ".") parent = "";
      }
      if (!found) throw new Error(`Missing locked dependency: ${key} -> ${name}`);
      const dependency = lock.packages[found];
      if ((dependency.os && !dependency.os.includes(process.platform)) || (dependency.cpu && !dependency.cpu.includes(process.arch))) {
        if (entry.optionalDependencies?.[name]) continue;
        throw new Error(`Incompatible dependency: ${found}`);
      }
      pending.push(dependency.link ? dependency.resolved : found);
    }
  }
  return result;
}

export async function buildBundle(output, { root = repository, node = process.execPath, nodeLicense } = {}) {
  output = path.resolve(output);
  try { await lstat(output); throw new Error("Hub output already exists"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const nodeVersion = execFileSync(node, ["--version"], { encoding: "utf8" }).trim();
  if (!/^v22\.\d+\.\d+$/u.test(nodeVersion)) throw new Error("Hub requires Node 22");
  const target = JSON.parse(execFileSync(node, ["-p", "JSON.stringify([process.platform,process.arch])"], { encoding: "utf8" }));
  if (target[0] !== process.platform || target[1] !== process.arch) throw new Error("Hub packaging must run natively");
  const license = nodeLicense ?? path.resolve(path.dirname(node), "../LICENSE");
  const licenseText = await readFile(license, "utf8");
  if (!licenseText.includes("Node.js") || !licenseText.includes("Permission")) throw new Error("Expected the Node distribution LICENSE");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const sourceState = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim() ? "modified" : "clean";
  const staging = `${output}.partial-${process.pid}`;
  await mkdir(staging, { recursive: false });
  try {
    for (const name of ["package.json", "package-lock.json", "LICENSE", "NOTICE", "COMMERCIAL-LICENSE.md", "TRADEMARKS.md",
      "apps/server/package.json", "apps/server/dist", "apps/server/migrations", "apps/web/dist"]) {
      await copyTree(path.join(root, name), path.join(staging, name));
    }
    for (const name of ["package.json", "generated", "src"]) {
      await copyTree(path.join(root, "packages/contracts", name), path.join(staging, "node_modules/@convene-wire/contracts", name));
    }
    const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
    for (const [name, locked] of productionPackages(lock)) {
      const installed = JSON.parse(await readFile(path.join(root, name, "package.json"), "utf8"));
      if (installed.version !== locked.version) throw new Error(`Installed dependency differs from lock: ${name}`);
      await copyTree(path.join(root, name), path.join(staging, name), (source) => path.basename(source) === "node_modules");
    }
    await mkdir(path.join(staging, "bin"));
    const executable = path.join(staging, "bin", process.platform === "win32" ? "node.exe" : "node");
    await copyFile(node, executable);
    await chmod(executable, 0o755);
    await writeFile(path.join(staging, "NODE-LICENSE"), licenseText);
    execFileSync(executable, ["-e", "const D=require('better-sqlite3');const db=new D(':memory:');if(db.prepare('select 42 as n').get().n!==42)process.exit(1);db.close()"],
      { cwd: staging, env: { PATH: "", ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}) }, stdio: "pipe" });
    const manifest = { schemaVersion: 1, platform: process.platform, arch: process.arch, nodeVersion, sourceCommit, sourceState, files: await inventory(staging) };
    await writeFile(path.join(staging, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
    await verifyBundle(staging);
    await rename(staging, output);
    return manifest;
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, directory, ...extra] = process.argv.slice(2);
  if (!directory || extra.length || !["build", "verify"].includes(command)) throw new Error("Usage: bundle.mjs build|verify DIRECTORY");
  const result = command === "build" ? await buildBundle(directory, { nodeLicense: process.env.CONVENE_WIRE_NODE_LICENSE }) : await verifyBundle(directory);
  console.log(JSON.stringify({ platform: result.platform, arch: result.arch, nodeVersion: result.nodeVersion, sourceCommit: result.sourceCommit, files: result.files.length }));
}
