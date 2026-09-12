import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { createServer } from "node:https";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import type { RelayChallenge, RelayRegistered } from "@convene-wire/contracts/peer";
import { relayHostname, relayRegistrationTranscript } from "@convene-wire/contracts/relay-proof";
import { RelayConnector } from "../src/local-node/relay-connector.js";
import { createRelayCAFixture } from "./helpers/relay-ca-fixture.js";

const secret = () => randomBytes(32).toString("base64url");
async function until(check: () => boolean, label: string, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (check()) return; await delay(5); }
  throw new Error(label);
}
type Control = { socket: WebSocket; token: string; challenge: RelayChallenge; registered: unknown[] };
type Stream = { socket: WebSocket; request: IncomingMessage; frames: Array<{ bytes: Buffer; binary: boolean }> };
async function fakeRelay(t: TestContext, behavior: {
  challenge?: (challenge: RelayChallenge) => string | Buffer;
  challengeBinary?: boolean;
  registered?: (registered: RelayRegistered) => string;
  retryMilliseconds?: number;
} = {}) {
  const ca = await createRelayCAFixture(t), material = await ca.tls(["relay.fixture.test"]);
  const server = createServer(material, (_request, response) => { response.writeHead(404); response.end(); });
  const ws = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 2 * 1024 * 1024 });
  const controls: Control[] = [], streams: Stream[] = [], tls: Duplex[] = [], http01: Duplex[] = [], changes: boolean[] = [];
  const pair = generateKeyPairSync("ed25519"), publicKey = createPublicKey(pair.privateKey).export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
  let signatures = 0;
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const profile = { ...ca.profile, relayOrigin: `https://relay.fixture.test:${address.port}` };
  server.on("upgrade", (request, socket, head) => {
    if (!["/v1/relay/control", "/v1/relay/stream"].includes(request.url!)) { socket.destroy(); return; }
    ws.handleUpgrade(request, socket, head, socket => {
      socket.on("error", () => {});
      if (request.url === "/v1/relay/control") {
        const challenge: RelayChallenge = { schemaVersion: 1, type: "challenge", nonce: secret(), expiresAt: new Date(Date.now() + 20_000).toISOString(), relayOrigin: profile.relayOrigin, nodeDomain: profile.nodeDomain };
        const record: Control = { socket, token: secret(), challenge, registered: [] }; controls.push(record);
        socket.on("message", (bytes, binary) => {
          assert.equal(binary, false); const message = JSON.parse(bytes.toString()); record.registered.push(message);
          assert.equal(message.type, "register"); assert.equal(message.nodeId, "node_connectorfixture1"); assert.equal(message.publicKey, publicKey);
          assert.ok(verify(null, relayRegistrationTranscript(challenge.relayOrigin, challenge.nodeDomain, challenge.nonce, message.nodeId, message.publicKey), pair.publicKey, Buffer.from(message.signature, "base64url")));
          const registered: RelayRegistered = { schemaVersion: 1, type: "registered", hostname: relayHostname(publicKey, profile.nodeDomain), sessionToken: record.token };
          socket.send(behavior.registered?.(registered) ?? JSON.stringify(registered));
        });
        socket.send(behavior.challenge?.(challenge) ?? JSON.stringify(challenge), { binary: behavior.challengeBinary ?? false });
      } else {
        const record: Stream = { socket, request, frames: [] }; streams.push(record);
        socket.on("message", (data, binary) => record.frames.push({ bytes: Buffer.from(data as Buffer), binary }));
      }
    });
  });
  const connector = new RelayConnector({ profile, signer: { nodeId: "node_connectorfixture1", publicKey,
    sign: transcript => { signatures++; return sign(null, transcript, pair.privateKey).toString("base64url"); } }, agent: ca.agent,
    retryMilliseconds: behavior.retryMilliseconds ?? 20, acceptTLS: stream => tls.push(stream), acceptHTTP01: stream => http01.push(stream),
    connectionChanged: connected => changes.push(connected) });
  t.after(async () => {
    await connector.close(); for (const socket of ws.clients) socket.terminate();
    await new Promise<void>(resolve => ws.close(() => resolve())); await new Promise<void>(resolve => server.close(() => resolve()));
  });
  connector.start();
  const open = (kind = "tls", streamId = secret(), epoch = controls.at(-1)!) => {
    epoch.socket.send(JSON.stringify({ schemaVersion: 1, type: "open", streamId, kind })); return streamId;
  };
  return { ca, connector, controls, streams, tls, http01, changes, open, signatures: () => signatures };
}

test("Relay connector rejects malformed, ambiguous or wrongly addressed challenges before signing", async t => {
  const cases: Array<{ name: string; change: (value: RelayChallenge) => string | Buffer; binary?: boolean }> = [
    { name: "other relay origin", change: value => JSON.stringify({ ...value, relayOrigin: "https://other.fixture.test" }) },
    { name: "other node domain", change: value => JSON.stringify({ ...value, nodeDomain: "other.fixture.test" }) },
    { name: "expired", change: value => JSON.stringify({ ...value, expiresAt: new Date(Date.now() - 1000).toISOString() }) },
    { name: "over thirty seconds", change: value => JSON.stringify({ ...value, expiresAt: new Date(Date.now() + 31_000).toISOString() }) },
    { name: "fraction rounded to one", change: value => JSON.stringify(value).replace('"schemaVersion":1', '"schemaVersion":1.00000000000000001') },
    { name: "duplicate decoded key", change: value => JSON.stringify(value).replace('"type":"challenge"', '"type":"challenge","\\u0074ype":"challenge"') },
    { name: "unknown authority field", change: value => JSON.stringify({ ...value, roomId: "room_foreign001" }) },
    { name: "binary control", binary: true, change: value => Buffer.from(JSON.stringify(value)) },
    { name: "oversized control", change: value => JSON.stringify({ ...value, padding: "x".repeat(4096) }) },
    { name: "malformed UTF8", change: () => Buffer.from([0xff]) }
  ];
  for (const entry of cases) await t.test(entry.name, async child => {
    const f = await fakeRelay(child, { challenge: entry.change, challengeBinary: entry.binary ?? false });
    await until(() => Boolean(f.controls[0]) && (f.controls[0]!.socket.readyState === WebSocket.CLOSED || f.signatures() > 0), entry.name);
    assert.equal(f.signatures(), 0); assert.equal(f.connector.isConnected(), false); assert.equal(f.tls.length, 0);
    assert.equal(f.ca.counters.requests, 0, "connector must not call a CA itself");
  });
});

test("Relay connector rejects substituted route and invalid registration before declaring ready", async t => {
  for (const change of [
    (value: RelayRegistered) => ({ ...value, hostname: `n${"0".repeat(40)}.nodes.fixture.test` }),
    (value: RelayRegistered) => ({ ...value, sessionToken: value.sessionToken.slice(0, -1) + "B" }),
    (value: RelayRegistered) => ({ ...value, type: "challenge" }),
    (value: RelayRegistered) => ({ ...value, localOwnerToken: secret() })
  ]) await t.test("registration mismatch", async child => {
    const f = await fakeRelay(child, { registered: value => JSON.stringify(change(value)) });
    await until(() => Boolean(f.controls[0]) && f.controls[0]!.socket.readyState === WebSocket.CLOSED, "registration not rejected");
    assert.ok(f.signatures() > 0); assert.equal(f.changes.includes(true), false); assert.equal(f.streams.length, 0);
  });
});

test("Relay duplicate open ends its epoch and destroys a paused consumer", async t => {
  const f = await fakeRelay(t, { retryMilliseconds: 10_000 }); await until(() => f.connector.isConnected(), "register");
  const id = f.open(); await until(() => f.tls.length === 1 && f.streams.length === 1, "TLS stream");
  f.streams[0]!.socket.send(Buffer.from("buffered old epoch"));
  await until(() => f.tls[0]!.readableLength > 0, "paused consumer receives bounded data");
  f.open("tls", id);
  await until(() => f.controls[0]!.socket.readyState === WebSocket.CLOSED, "duplicate stream closes control");
  await until(() => f.tls[0]!.destroyed, "epoch must destroy unread consumer rather than retain only EOF");
  assert.equal(f.streams.length, 1); assert.equal(f.connector.isConnected(), false);
});

test("Relay reconnect replaces session tokens and never carries buffered bytes to the next epoch", async t => {
  const f = await fakeRelay(t); await until(() => f.connector.isConnected(), "register");
  const id = f.open(); await until(() => f.tls.length === 1 && f.streams.length === 1, "first stream");
  f.streams[0]!.socket.send(Buffer.from("old ciphertext")); await until(() => f.tls[0]!.readableLength > 0, "old buffered bytes");
  f.controls[0]!.socket.terminate();
  await until(() => f.controls.length >= 2 && f.connector.isConnected(), "reconnect");
  assert.equal(f.tls[0]!.destroyed, true); f.open("tls", id);
  await until(() => f.tls.length === 2 && f.streams.length === 2, "second stream");
  assert.equal(f.streams[0]!.request.url, "/v1/relay/stream"); assert.equal(f.streams[1]!.request.url, "/v1/relay/stream");
  assert.equal(f.streams[0]!.request.headers.authorization, `Bearer ${f.controls[0]!.token}`);
  assert.equal(f.streams[1]!.request.headers.authorization, `Bearer ${f.controls[1]!.token}`);
  assert.notEqual(f.controls[0]!.token, f.controls[1]!.token); assert.equal(f.streams[1]!.request.headers["x-convenewire-relay-stream"], id);
  const chunks: Buffer[] = []; f.tls[1]!.on("data", chunk => chunks.push(Buffer.from(chunk)));
  f.streams[1]!.socket.send(Buffer.from("new ciphertext"));
  await until(() => chunks.length > 0, "new bytes"); assert.equal(Buffer.concat(chunks).toString(), "new ciphertext");
});

test("Relay data gate rejects text and fragmented oversized messages before the TLS or HTTP consumer", async t => {
  for (const [kind, oversized] of [["tls", false], ["http01", true]] as const) await t.test(kind, async child => {
    const f = await fakeRelay(child); await until(() => f.connector.isConnected(), "register"); f.open(kind);
    const consumers = kind === "tls" ? f.tls : f.http01;
    await until(() => consumers.length === 1 && f.streams.length === 1, "consumer");
    let bytes = 0; consumers[0]!.on("data", chunk => { bytes += chunk.length; });
    if (oversized) {
      f.streams[0]!.socket.send(Buffer.alloc(32 * 1024, 1), { binary: true, fin: false });
      f.streams[0]!.socket.send(Buffer.alloc(32 * 1024 + 1, 2), { binary: true, fin: true });
    } else f.streams[0]!.socket.send("text is forbidden", { binary: false });
    await until(() => consumers[0]!.destroyed, "invalid stream rejected");
    assert.equal(bytes, 0); assert.equal(f.connector.isConnected(), true, "a data-frame violation is scoped to that stream");
  });
});

test("Relay streams preserve byte order, fragment bounded writes and propagate backpressure", async t => {
  const f = await fakeRelay(t); await until(() => f.connector.isConnected(), "register"); f.open();
  await until(() => f.tls.length === 1 && f.streams.length === 1, "consumer");
  const stream = f.tls[0]!, wire = f.streams[0]!;
  const payload = randomBytes(192 * 1024 + 17);
  const sent = new Promise<void>((resolve, reject) => {
    assert.equal(stream.write(payload, error => error ? reject(error) : resolve()), false, "caller must observe writable backpressure");
  });
  await sent; await until(() => wire.frames.reduce((total, frame) => total + frame.bytes.length, 0) === payload.length, "outbound bytes");
  assert.ok(wire.frames.every(frame => frame.binary && frame.bytes.length <= 32 * 1024));
  assert.deepEqual(Buffer.concat(wire.frames.map(frame => frame.bytes)), payload);
  const inbound = randomBytes(512 * 1024);
  for (let offset = 0; offset < inbound.length; offset += 32 * 1024) wire.socket.send(inbound.subarray(offset, offset + 32 * 1024));
  await until(() => stream.readableLength >= 64 * 1024, "inbound high water mark");
  await delay(30);
  assert.ok(stream.readableLength <= 128 * 1024, `bounded inbound buffering: ${stream.readableLength}`);
  const received: Buffer[] = []; stream.on("data", chunk => received.push(Buffer.from(chunk)));
  await until(() => received.reduce((total, chunk) => total + chunk.length, 0) === inbound.length, "backpressure resumes");
  assert.deepEqual(Buffer.concat(received), inbound);
  const ended = new Promise<void>(resolve => stream.once("end", resolve));
  wire.socket.send(Buffer.from("final frame")); wire.socket.close(); await ended;
  assert.equal(Buffer.concat(received).subarray(-11).toString(), "final frame", "EOF cannot truncate the final valid message");
});

test("Relay capacity and shutdown bound pending channels and clear reconnect work", async t => {
  const f = await fakeRelay(t, { retryMilliseconds: 10_000 }); await until(() => f.connector.isConnected(), "register");
  for (let index = 0; index < 65; index++) f.open();
  await until(() => f.controls[0]!.socket.readyState === WebSocket.CLOSED, "capacity must close the epoch");
  assert.ok(f.tls.length <= 64);
  await f.connector.close(); assert.equal(f.connector.isConnected(), false);
  assert.ok(f.tls.every(stream => stream.destroyed));
  const count = f.controls.length; await delay(50); assert.equal(f.controls.length, count, "closed connector does not reconnect");
});
