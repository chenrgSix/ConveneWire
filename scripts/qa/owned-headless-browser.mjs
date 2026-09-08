import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { spawnTestProcess } from "../test/child-process.mjs";

// QA-only: a new, disposable process. Never attaches to a user browser/session.
export async function ownedHeadlessBrowser(resources, executable) {
  assert.match(path.basename(executable), /^(chrome-headless-shell|headless_shell)(\.exe)?$/u);
  const profile = path.join(resources.directory, "qa-browser-profile");
  await mkdir(profile, {mode: 0o700});
  const process = spawnTestProcess(resources, executable, ["--headless", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--disable-background-networking", "--disable-component-update", "--disable-extensions", "--disable-sync", "about:blank"],
  {stdio: ["ignore", "pipe", "pipe"]});
  let stderr = "";
  process.process.stderr.on("data", (data) => {stderr = (stderr + data).slice(-8000);});
  let address;
  for (let i=0;i<100;i++) {
    try { const [port, pathname] = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).trim().split("\n");
      if (/^\d+$/u.test(port) && pathname.startsWith("/devtools/browser/")) {address = `ws://127.0.0.1:${port}${pathname}`; break;} } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(address, `Owned headless browser did not start: ${stderr}`);
  const socket = new WebSocket(address); await new Promise((resolve,reject) => {socket.once("open",resolve);socket.once("error",reject);});
  resources.defer(() => {socket.terminate();});
  let id=0; const requests = new Map(); let session;
  socket.on("message", (raw) => {
    const response = JSON.parse(raw.toString()); const pending = requests.get(response.id);
    if (pending) {requests.delete(response.id); clearTimeout(pending.timer); response.error ? pending.reject(new Error(JSON.stringify(response.error))) : pending.resolve(response.result);}
  });
  const send = (method, params={}) => new Promise((resolve,reject) => {
    const requestId=++id; const timer=setTimeout(() => {requests.delete(requestId); reject(new Error(`CDP timeout: ${method}`));}, 10000);
    requests.set(requestId,{resolve,reject,timer}); socket.send(JSON.stringify({id:requestId,method,params,...(session ? {sessionId:session} : {})}));
  });
  const target = await send("Target.createTarget",{url:"about:blank"});
  session = (await send("Target.attachToTarget",{targetId:target.targetId,flatten:true})).sessionId;
  await send("Page.enable");
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  const until = async (expression) => {
    for (let i=0;i<200;i++) {if (await evaluate(expression)) return;await new Promise((resolve) => setTimeout(resolve,50));}
    throw new Error(`UI condition failed: ${expression}; ${await evaluate("document.body.innerText.slice(-5000)")}`);
  };
  const viewport = (width,height) => send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:false});
  await viewport(1440,1000);
  return {send,evaluate,until,viewport,
    navigate: async (url) => {const parsed=new URL(url); assert.equal(parsed.hostname,"127.0.0.1");await send("Page.navigate",{url});await until("document.readyState === 'complete'");},
    screenshot: async (filename) => {const result=await send("Page.captureScreenshot",{format:"png"});await writeFile(filename,Buffer.from(result.data,"base64"));},
    close: async () => {socket.terminate();await process.stop();}
  };
}
