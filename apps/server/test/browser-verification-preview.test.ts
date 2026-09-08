import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { browserVerificationPreview } from "../src/artifact/browser-verification-preview.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5V8AAAAASUVORK5CYII=", "base64");
function report() {return {version: 1, browser: {version: 1, kind: "browser", startup: "passed", pageLoad: "passed", cleanup: "completed", reason: "completed", visualReview: "not_performed",
  steps: [{action: "text", selector: "h1", state: "passed"}], screenshot: {state: "captured", mimeType: "image/png", data: png.toString("base64"), sha256: createHash("sha256").update(png).digest("hex")}}};}
const parse = (value: unknown) => browserVerificationPreview(Buffer.from(JSON.stringify(value)));
test("browser preview retains bounded PNG and separates visual review from assertions", () => {
  const parsed = parse(report()); assert.equal(parsed?.visualReview, "not_performed"); assert.match(parsed!.screenshot.dataUrl!, /^data:image\/png;base64,/u);
  const failed = report(); Object.assign(failed.browser, {startup: "failed", pageLoad: "not_run", steps: [], reason: "browser_start_failed"});
  Object.assign(failed.browser.screenshot, {state: "not_run"}); assert.equal(parse(failed)?.screenshot.dataUrl, null);
});
test("untrusted logs cannot inject executable images, alter hashes or claim visual acceptance", () => {
  for (const mutate of [
    (v: ReturnType<typeof report>) => {v.browser.screenshot.mimeType = "image/svg+xml";},
    (v: ReturnType<typeof report>) => {v.browser.screenshot.sha256 = "a".repeat(64);},
    (v: ReturnType<typeof report>) => {v.browser.screenshot.data += "!";},
    (v: ReturnType<typeof report>) => {v.browser.visualReview = "passed";},
    (v: ReturnType<typeof report>) => {v.browser.steps[0]!.action = "evaluate";},
    (v: ReturnType<typeof report>) => {v.browser.screenshot.data = "x".repeat(1_000_001);}
  ]) {const value = report(); mutate(value); assert.equal(parse(value), undefined);}
  assert.equal(browserVerificationPreview(Buffer.from([0xff])), undefined);
  assert.equal(browserVerificationPreview(Buffer.alloc(1_048_577)), undefined);
});
