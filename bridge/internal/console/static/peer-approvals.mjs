// These requests belong to the current native Runtime callback. They are not
// Device trust or durable consent, and a decision is never replayed by polling.
export function createPeerApprovalsController({root, badge, request, now = Date.now}) {
  const document = root.ownerDocument, c = name => root.querySelector(`[data-approval-${name}]`);
  const dialog = c("dialog"), attempted = new Set();
  let nodeId = "", active = false, epoch = 0, loading = false, lastLoad = -Infinity;
  let pending = [], selected = null, busy = false, readError = "", fingerprint = "";
  const key = value => JSON.stringify([value.requestId, value.processId, value.bindingDigest, value.consentRevision]);
  const live = value => value?.binding.participantNodeId === nodeId && Date.parse(value.expiresAt) > now();
  const make = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const current = () => selected && pending.some(value => JSON.stringify(value) === JSON.stringify(selected) && live(value));
  const trigger = value => [...c("list").querySelectorAll("button")].find(button => button.dataset.approvalKey === key(value));
  function close(restore = true) {
    const previous = selected; selected = null;
    if (dialog.open) dialog.close();
    c("scope").replaceChildren(); c("details").textContent = c("error").textContent = "";
    if (restore && previous) (trigger(previous) ?? c("refresh")).focus();
  }
  function retire() {
    epoch++; loading = busy = false; pending = []; lastLoad = -Infinity; fingerprint = readError = "";
    close(false); attempted.clear(); c("list").replaceChildren(); c("result").textContent = "";
    badge.textContent = ""; badge.hidden = true;
  }
  function controls() {
    const consumed = selected && attempted.has(key(selected));
    for (const name of ["allow", "deny"]) c(name).disabled = !active || busy || !current() || consumed;
    c("refresh").disabled = loading || !nodeId;
    if (selected && !busy && !consumed && !current()) c("error").textContent = "请求已结束、过期或执行范围已变化，请关闭并查看当前运行。";
  }
  function open(value) {
    if (!active || busy || !live(value) || !pending.some(entry => JSON.stringify(entry) === JSON.stringify(value)) || attempted.has(key(value))) return;
    close(false); selected = structuredClone(value);
    const binding = value.binding, dl = make("dl", undefined, "peer-details");
    for (const [label, text] of [["操作", value.operationKind === "command" ? "执行命令" : "修改文件"], ["远端 Node", binding.authorityNodeId],
      ["Team / 房间", `${binding.teamId} / ${binding.roomId}`], ["本机 Agent", binding.localAgentId], ["运行", binding.runId],
      ["分享版本", `${binding.exportId} · ${value.consentRevision}`], ["请求有效至", new Date(value.expiresAt).toLocaleString()]]) {
      const row = make("div"); row.append(make("dt", label), make("dd", text)); dl.append(row);
    }
    c("scope").append(dl); c("details").textContent = value.details; controls(); dialog.showModal(); c("close").focus();
  }
  function renderList() {
    const values = pending.filter(live);
    badge.hidden = !values.length; badge.textContent = values.length ? `${values.length} 待审批` : "";
    const next = JSON.stringify([active, values, [...attempted], readError]);
    if (next !== fingerprint) {
      fingerprint = next;
      const focused = c("list").contains(document.activeElement) ? document.activeElement.dataset.approvalKey : null;
      const nodes = [];
      if (active) {
        if (readError) nodes.push(make("p", readError, "peer-error"));
        else if (!values.length) nodes.push(make("p", "当前没有等待本机审批的远端运行。", "peer-empty"));
        for (const value of values) {
          const card = make("article", undefined, "peer-space-card"), button = make("button", attempted.has(key(value)) ? "已提交，请等待运行结果" : "审阅本次请求", "secondary");
          card.append(make("h4", value.operationKind === "command" ? "命令权限请求" : "文件变更请求"), make("p", `本机 Agent：${value.binding.localAgentId}`), make("p", `远端房间：${value.binding.roomId} · 运行：${value.binding.runId}`));
          button.type = "button"; button.dataset.approvalKey = key(value); button.disabled = attempted.has(key(value)); button.addEventListener("click", () => open(value)); card.append(button); nodes.push(card);
        }
      }
      c("list").replaceChildren(...nodes);
      if (focused) ([...c("list").querySelectorAll("button")].find(button => button.dataset.approvalKey === focused) ?? c("refresh")).focus();
    }
    controls();
  }
  async function refresh() {
    if (!nodeId || loading) return;
    const generation = epoch; loading = true; lastLoad = now(); controls();
    try {
      const result = await request("/api/peers/approvals");
      if (generation !== epoch) return;
      pending = result.approvals ?? []; readError = "";
    } catch (error) {
      if (generation !== epoch) return;
      if (error.status === 401) { nodeId = ""; retire(); return; }
      pending = []; readError = "本机审批状态暂不可用，请刷新后重新核对。";
    } finally { if (generation === epoch) { loading = false; renderList(); } }
  }
  async function decide(allow) {
    if (!active || busy || !current() || attempted.has(key(selected))) return;
    const value = structuredClone(selected), generation = epoch;
    attempted.add(key(value)); busy = true; c("error").textContent = "正在提交本次决定…"; renderList();
    try {
      await request(`/api/peers/approvals/${encodeURIComponent(value.requestId)}`, {method: "POST", body: JSON.stringify({processId: value.processId,
        bindingDigest: value.bindingDigest, consentRevision: value.consentRevision, allow})});
      if (generation !== epoch) return;
      c("result").textContent = allow ? "已提交本次允许决定；Runtime 仍会检查当前运行权限。" : "已提交本次拒绝决定。";
      if (selected && key(selected) === key(value)) close();
    } catch (error) {
      if (generation !== epoch) return;
      if (error.status === 401) { nodeId = ""; retire(); return; }
      const message = error.status === 409 ? "请求已结束或执行范围已变化，本次决定未被接收。" : "决定结果尚未确认，不会自动重试。请查看当前运行，等待请求结束。";
      c("result").textContent = message;
      if (selected && key(selected) === key(value)) c("error").textContent = message;
    } finally { if (generation === epoch) { busy = false; controls(); await refresh(); } }
  }
  c("refresh").addEventListener("click", () => void refresh());
  c("allow").addEventListener("click", () => void decide(true));
  c("deny").addEventListener("click", () => void decide(false));
  c("close").addEventListener("click", () => close());
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("keydown", event => {
    if (event.key !== "Tab") return;
    const buttons = [...dialog.querySelectorAll("button")].filter(button => !button.disabled);
    if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
  });
  return {render(state) { const next = state?.localNodeId || ""; if (next !== nodeId) { retire(); nodeId = next; } renderList(); if (nodeId && now() - lastLoad >= 1000) void refresh(); },
    setActive(value) { if (active === value) return; active = value; if (!active) close(false); renderList(); if (active) void refresh(); }, refresh,
    dispose() { nodeId = ""; active = false; retire(); }};
}
