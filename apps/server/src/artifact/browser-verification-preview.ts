import { createHash } from "node:crypto";

/** A bounded reading of an untrusted verifier log, never execution authority. */
export interface BrowserVerificationPreview {
  startup: string; pageLoad: string; cleanup: string; reason: string; visualReview: "not_performed";
  steps: Array<{action: string; selector: string; state: string}>;
  screenshot: {state: string; dataUrl: string | null};
}
export function browserVerificationPreview(bytes: Buffer): BrowserVerificationPreview | undefined {
  if (bytes.length > 1_048_576) return;
  let value: any;
  try {value = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));} catch {return;}
  const browser = value?.browser;
  if (value?.version !== 1 || browser?.version !== 1 || browser.kind !== "browser" || browser.visualReview !== "not_performed" ||
    !["not_run", "passed", "failed"].includes(browser.startup) || !["not_run", "passed", "failed"].includes(browser.pageLoad) ||
    !["completed", "failed"].includes(browser.cleanup) || typeof browser.reason !== "string" || browser.reason.length > 64 ||
    !Array.isArray(browser.steps) || browser.steps.length > 32 || browser.steps.some((step: any) =>
      !["click", "fill", "visible", "text"].includes(step?.action) || !["passed", "failed"].includes(step?.state) || typeof step?.selector !== "string" || step.selector.length > 512)) return;
  const screenshot = browser.screenshot;
  if (!["not_requested", "not_run", "captured", "failed", "output_limit"].includes(screenshot?.state)) return;
  let dataUrl: string | null = null;
  if (screenshot.state === "captured") {
    if (screenshot.mimeType !== "image/png" || typeof screenshot.data !== "string" || screenshot.data.length > 1_000_000 ||
      typeof screenshot.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(screenshot.sha256)) return;
    const data = Buffer.from(screenshot.data, "base64");
    if (data.toString("base64") !== screenshot.data || data.length < 24 || data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      data.subarray(12,16).toString() !== "IHDR" || data.readUInt32BE(16) > 1920 || data.readUInt32BE(20) > 1080 ||
      data.readUInt32BE(16) < 1 || data.readUInt32BE(20) < 1 || createHash("sha256").update(data).digest("hex") !== screenshot.sha256) return;
    dataUrl = `data:image/png;base64,${screenshot.data}`;
  }
  return {startup: browser.startup, pageLoad: browser.pageLoad, cleanup: browser.cleanup, reason: browser.reason,
    visualReview: "not_performed", steps: browser.steps.map((step: any) => ({action: step.action, selector: step.selector, state: step.state})),
    screenshot: {state: screenshot.state, dataUrl}};
}
