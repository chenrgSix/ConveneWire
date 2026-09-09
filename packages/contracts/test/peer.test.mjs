import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalPeerJson } from "../src/peer-json.mjs";
import { decodePeer, validatePeer } from "../src/peer-validation.mjs";
import { peerDigest, peerProofTranscript, peerProofTimeValid } from "../src/peer-proof.mjs";
const fixture = JSON.parse(await readFile(new URL("./fixtures/peer.json",import.meta.url)));
const vector = JSON.parse(await readFile(new URL("./fixtures/peer-proof.json",import.meta.url)));

test("Peer control schema separates identities, ceilings, grants and settlement", () => {
  for (const item of fixture.cases) assert.equal(validatePeer(item.kind,item.value),item.valid,item.description);
  for (const item of fixture.raw) {
    if (item.valid) assert.ok(decodePeer(item.kind,item.raw));
    else assert.throws(()=>decodePeer(item.kind,item.raw),item.raw);
  }
  assert.equal(validatePeer("DevicePrincipal",{}),false);
});

test("Peer Ed25519 proof binds all authority, purpose, digest and freshness fields", () => {
  const key = createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),Buffer.from(vector.proof.payload.signerPublicKey,"base64url")]),format:"der",type:"spki"});
  const transcript = peerProofTranscript(vector.proof.payload);
  assert.equal(Buffer.from(transcript).toString(),vector.transcript);
  assert.equal(peerDigest(vector.binding),vector.proof.payload.subjectDigest);
  assert.ok(verify(null,transcript,key,Buffer.from(vector.proof.signature,"base64url")));
  for (const field of Object.keys(vector.proof.payload)) {
    const changed={...vector.proof.payload,[field]:field==="schemaVersion"?2:field==="purpose"?"peer.connect":field.endsWith("At")?"2026-09-10T02:00:01.000Z":field==="subjectDigest"?"b".repeat(64):field==="nonce"||field==="signerPublicKey"?"A".repeat(43):vector.proof.payload[field]+"x"};
    try { assert.equal(verify(null,peerProofTranscript(changed),key,Buffer.from(vector.proof.signature,"base64url")),false,field); }
    catch(error) { if(error.code==="ERR_ASSERTION")throw error;assert.match(error.message,/Invalid Peer proof payload/u); }
  }
  const p=vector.proof.payload,now=Date.parse(vector.now);
  assert.equal(peerProofTimeValid(p,now),true);
  assert.equal(peerProofTimeValid(p,now-5000),true);
  assert.equal(peerProofTimeValid(p,now-5001),false);
  assert.equal(peerProofTimeValid(p,now+30000),false);
  assert.equal(peerProofTimeValid({...p,expiresAt:p.issuedAt},now),false);
  assert.equal(peerProofTimeValid({...p,expiresAt:"2026-09-10T02:00:30.001Z"},now),false);
});

test("actual Go Peer decoder and proof transcript agree with Node", () => {
  const cases=[...fixture.cases.map(x=>({kind:x.kind,raw:JSON.stringify(x.value),valid:x.valid})),...fixture.raw,{kind:"PeerProof",raw:JSON.stringify(vector.proof),valid:true}];
  const result=spawnSync("go",["run","./test/interop-peer"],{cwd:new URL("../",import.meta.url),input:cases.map(x=>JSON.stringify({Kind:x.kind,Raw:x.raw})).join("\n")+"\n",encoding:"utf8",maxBuffer:8*1024*1024,timeout:120000});
  assert.equal(result.status,0,result.stderr);
  const output=result.stdout.trim().split("\n").map(x=>JSON.parse(x));assert.equal(output.length,cases.length);
  for(let i=0;i<cases.length;i++){
    assert.equal(output[i].valid,cases[i].valid,JSON.stringify(cases[i]));
    if(cases[i].valid)assert.equal(output[i].canonical,Buffer.from(canonicalPeerJson(decodePeer(cases[i].kind,cases[i].raw))).toString());
  }
  assert.equal(output.at(-1).transcript,vector.transcript);assert.equal(output.at(-1).signatureValid,true);
});

test("Peer private state binds the Host receipt to invitation, membership and machine credential", async () => {
  const join = JSON.parse(await readFile(new URL("./fixtures/peer-join.json", import.meta.url)));
  assert.equal(validatePeer("PeerParticipantState", join.state), true);
  assert.equal(validatePeer("PeerParticipantState", join.authorized), true);
  const receipt = join.state.connections[0].receipt;
  const digest = value => peerDigest({ invitationDigest: peerDigest(value.invitation), membership: value.membership, machineCredential: value.machineCredential });
  assert.equal(digest(receipt), receipt.proof.payload.subjectDigest);
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(receipt.invitation.host.publicKey, "base64url")]), format: "der", type: "spki" });
  assert.ok(verify(null, peerProofTranscript(receipt.proof.payload), key, Buffer.from(receipt.proof.signature, "base64url")));
  for (const change of [
    value => { value.invitation.hostOrigin = "https://changed.example.test"; },
    value => { value.invitation.membershipExpiresAt = "2027-01-01T00:00:00.000Z"; },
    value => { value.membership.localUserId = "user_substituted001"; },
    value => { value.membership.scope.roomId = "room_substituted001"; },
    value => { value.machineCredential.token = "A".repeat(43); }
  ]) {
    const changed = structuredClone(receipt);
    change(changed);
    assert.notEqual(digest(changed), receipt.proof.payload.subjectDigest);
  }
});

test("Participant admission fixtures retain separately signed human receipts and exchange deadlines", async () => {
  const f = JSON.parse(await readFile(new URL("./fixtures/peer-admission.json", import.meta.url)));
  for (const [kind, value] of [["PeerInvitationPreview", f.preview], ["PeerJoined", f.joined], ["PeerHumanEntry", f.entry]]) assert.equal(validatePeer(kind, value), true, kind);
  const h = f.joined.human;
  const expected = peerDigest({ host: h.host, participant: h.participant, localUserId: h.localUserId,
    joinReceiptDigest: h.joinReceiptDigest, humanCredential: h.humanCredential });
  assert.equal(h.proof.payload.subjectDigest, expected);
  assert.equal(f.entry.proof.payload.subjectDigest, peerDigest({ credential: f.entry.credential,
    exchangeExpiresAt: f.entry.exchangeExpiresAt, hostOrigin: f.entry.hostOrigin }));
  assert.notEqual(h.humanCredential.token, f.joined.runtime.machineCredential.token);
  for (const proof of [f.preview.proof, f.joined.runtime.proof, h.proof, f.entry.proof, f.localProof]) {
    const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(proof.payload.signerPublicKey, "base64url")]), format: "der", type: "spki" });
    assert.ok(verify(null, peerProofTranscript(proof.payload), key, Buffer.from(proof.signature, "base64url")));
  }
});
