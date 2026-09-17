import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdtemp, mkdir } from "node:fs/promises";
import { createTestResources } from "../test/resources.mjs";
import { spawnTestProcess } from "../test/child-process.mjs";

export const lanCases = ["TestGoParticipantJoinsRealServerOverTLSAndRecoversLostClaimResponse",
  "TestPeerRunExecutionUsesActualHostAndRestrictedNativeChild",
  "TestPeerDiscussionRunsUseNativeSessionsAndFrozenFinalization",
  "TestGoPeerRunDeliveryEventsAndRevokedSettlementUseActualHost"];
export function privateIPv4(value) {
  return net.isIPv4(value) && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|127\.)/u.test(value);
}
export function acceptedLanHello(value, token) {
  return Boolean(value && typeof value.token === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value.token) && value.token.length === token.length &&
    timingSafeEqual(Buffer.from(value.token), Buffer.from(token)) && lanCases.includes(value.test) &&
    typeof value.now === "string" && Number.isFinite(Date.parse(value.now)) &&
    Object.keys(value).sort().join() === "now,test,token");
}

async function main() {
  const [host, participant, binary, evidence] = process.argv.slice(2);
  if (!privateIPv4(host) || !privateIPv4(participant) || !binary || !evidence || !process.env.CONVENE_WIRE_TEST_RUN_ROOT) {
    throw new Error("Usage within run-with-temp-root: lan-peer-fixture.mjs PRIVATE_HOST PRIVATE_PARTICIPANT WINDOWS_TEST_BINARY EVIDENCE_DIRECTORY");
  }
  const repository = fileURLToPath(new URL("../../", import.meta.url));
  const cleanups = [], jobs = [], children = [], sockets = new Set();
  const resources = await createTestResources({ after: fn => cleanups.push(fn) }, "convenewire-lan-peer-");
  const certFile = path.join(resources.directory, "host-cert.pem"), keyFile = path.join(resources.directory, "host-key.pem");
  const token = randomBytes(32).toString("base64url");
  let finish;
  const stopped = new Promise(resolve => { finish = resolve; });
  const timer = setTimeout(finish, 20 * 60_000);
  process.once("SIGTERM", finish); process.once("SIGINT", finish);
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
      "-keyout", keyFile, "-out", certFile, "-days", "1", "-subj", "/CN=ConveneWire disposable LAN fixture",
      "-addext", `subjectAltName=IP:${host}`, "-addext", "basicConstraints=critical,CA:FALSE",
      "-addext", "extendedKeyUsage=serverAuth"], { stdio: "ignore" });
    const cert = await readFile(certFile), key = await readFile(keyFile);
    const allowedAddress = address => address === host || address === participant;
    const broker = tls.createServer({ cert, key, minVersion: "TLSv1.2", handshakeTimeout: 5_000 }, socket => {
      if (!allowedAddress(socket.remoteAddress)) { socket.destroy(); return; }
      sockets.add(socket); socket.once("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      socket.setTimeout(5_000, () => socket.destroy());
      let buffer = Buffer.alloc(0), claimed = false;
      const hello = chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > 4096) { socket.destroy(); return; }
        const cut = buffer.indexOf(10);
        if (cut < 0 || claimed) return;
        claimed = true; socket.pause(); socket.off("data", hello);
        let value;
        try { value = JSON.parse(buffer.subarray(0, cut).toString("utf8")); } catch { socket.destroy(); return; }
        if (!acceptedLanHello(value, token) || jobs.length >= 16 || jobs.filter(job => !job.finished).length >= 2) { socket.destroy(); return; }
        socket.setTimeout(180_000);
        const job = { test: value.test, participantAddress: socket.remoteAddress, finished: false, exitCode: null };
        jobs.push(job);
        void (async () => {
          const directory = await mkdtemp(path.join(resources.directory, "host-"));
          const child = spawnTestProcess(resources, process.execPath, ["--import", "tsx", "apps/server/test/helpers/peer-http-fixture.ts",
            directory, certFile, keyFile, value.now, "lan"], { cwd: repository,
            env: { ...process.env, CONVENE_WIRE_LAN_HOST: host }, stdio: ["pipe", "pipe", "pipe"] });
          children.push(child);
          let errors = "";
          child.process.stderr.on("data", chunk => { errors = (errors + chunk).slice(-8192); });
          child.process.stdin.on("error", () => socket.destroy());
          child.process.stdout.pipe(socket, { end: false });
          socket.pipe(child.process.stdin);
          socket.once("close", () => child.process.stdin.end());
          if (buffer.length > cut + 1) child.process.stdin.write(buffer.subarray(cut + 1));
          socket.resume();
          const result = await child.terminal;
          await child.stop();
          job.exitCode = result.code; job.finished = true;
          if (result.code !== 0) console.error("LAN fixture failed", value.test, errors);
          socket.end();
        })().catch(error => { job.finished = true; socket.destroy(); console.error(error); });
      };
      socket.on("data", hello);
    });
    broker.on("tlsClientError", () => {});
    await new Promise((resolve, reject) => { broker.once("error", reject); broker.listen(0, host, resolve); });
    resources.defer(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => broker.close(resolve)); });
    const manifest = { address: `${host}:${broker.address().port}`, token, caCertificatePem: cert.toString() };
    const manifestFile = path.join(resources.directory, "lan-fixture.json");
    await writeFile(manifestFile, JSON.stringify(manifest), { mode: 0o600 });
    const pattern = `^(${lanCases.join("|")})$`;
    const runner = path.join(resources.directory, "run.mjs");
    // Environment is scoped to the child; no install, policy or firewall change.
    await writeFile(runner, `import {spawnSync} from 'node:child_process';\nimport {mkdirSync,writeFileSync} from 'node:fs';\nimport {fileURLToPath} from 'node:url';\nimport path from 'node:path';\nconst root=path.dirname(fileURLToPath(import.meta.url)),temporary=path.join(root,'temp');\nmkdirSync(temporary,{recursive:true});\nconst result=spawnSync(path.join(root,'peer.test.exe'),['-test.v','-test.timeout=180s','-test.run=${pattern}'],{cwd:root,env:{...process.env,TEMP:temporary,TMP:temporary,CONVENE_WIRE_PEER_LAN_MANIFEST:path.join(root,'lan-fixture.json')},encoding:'utf8',timeout:210000,maxBuffer:1048576});\nconst output=(result.stdout??'')+(result.stderr??'')+'\\nCW_LAN_EXIT='+result.status+'\\n';\nwriteFileSync(path.join(root,'result.txt'),output);\nprocess.stdout.write(output);\nprocess.exitCode=result.status??1;\n`, { mode: 0o600 });
    const archive = path.join(resources.directory, "lan-peer.zip");
    execFileSync("python3", ["-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED); [(z.write(p,n)) for p,n in [(sys.argv[2],'peer.test.exe'),(sys.argv[3],'lan-fixture.json'),(sys.argv[4],'run.mjs')]]; z.close()", archive, binary, manifestFile, runner]);
    const bytes = await readFile(archive), sha256 = createHash("sha256").update(bytes).digest("hex");
    let resultReceived = false;
    const transfer = http.createServer(async (request, response) => {
      if (!allowedAddress(request.socket.remoteAddress) || request.headers.authorization !== `Bearer ${token}`) { response.writeHead(403).end(); return; }
      if (request.method === "GET" && request.url === "/bundle") { response.writeHead(200, { "content-type": "application/zip", "content-length": bytes.length }).end(bytes); return; }
      if (request.method === "POST" && request.url === "/result" && !resultReceived) {
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 1024 * 1024) { response.writeHead(413).end(); return; } chunks.push(chunk); }
        await mkdir(evidence, { recursive: true });
        await writeFile(path.join(evidence, "windows-result.txt"), Buffer.concat(chunks));
        resultReceived = true;
        response.writeHead(204).end();
        console.log("LAN_RESULT_RECEIVED");
        return;
      }
      if (request.method === "POST" && request.url === "/finish" && request.socket.remoteAddress === host) { response.writeHead(204).end(); finish(); return; }
      response.writeHead(404).end();
    });
    transfer.requestTimeout = 10_000;
    await new Promise((resolve, reject) => { transfer.once("error", reject); transfer.listen(0, host, resolve); });
    resources.defer(async () => { transfer.closeAllConnections(); await new Promise(resolve => transfer.close(resolve)); });
    const privateFile = path.join(process.env.CONVENE_WIRE_TEST_RUN_ROOT, "lan-access.json");
    await writeFile(privateFile, JSON.stringify({ manifest, download: `http://${host}:${transfer.address().port}/bundle`, sha256, archiveBytes: bytes.length }), { mode: 0o600 });
    console.log(JSON.stringify({ readyFile: privateFile, host, participant, archiveBytes: bytes.length, sha256 }));
    await stopped;
    for (const socket of sockets) socket.destroy();
    await Promise.all(children.map(child => child.stop()));
    await mkdir(evidence, { recursive: true });
    await writeFile(path.join(evidence, "lan-host.json"), JSON.stringify({ host, participant, resultReceived, jobs, binarySha256: createHash("sha256").update(await readFile(binary)).digest("hex"), archiveSha256: sha256 }, null, 2) + "\n");
  } finally {
    clearTimeout(timer); process.off("SIGTERM", finish); process.off("SIGINT", finish);
    for (const cleanup of cleanups.reverse()) await cleanup();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
