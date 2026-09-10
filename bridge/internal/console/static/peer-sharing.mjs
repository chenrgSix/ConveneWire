import {peerOperationId} from "./peer-spaces.mjs";

const capabilityLabels = {supportsStart: "启动任务", supportsStreaming: "输出进度", supportsInterrupt: "中断任务", supportsTaskContextIsolation: "独立任务上下文"};
const roomLinkKeys = new Set("team room view task workTask tab run scope lifecycleState ownerMemberId search attention priority filterRoomId filterAgentId".split(" "));
const roomID = value => /^room_[A-Za-z0-9_-]{8,128}$/u.test(value);

export function sharingRooms(text, connection) {
  const scope = connection.membership.scope;
  if (scope.kind === "room") return [scope.roomId];
  const values = text.trim().split(/\s+/u).filter(Boolean);
  if (!values.length || values.length > 64) throw new Error("请提供 1 至 64 个远端房间链接。");
  const rooms = values.map(value => {
    let url;
    try { url = new URL(value); } catch { throw new Error("请粘贴远端网页中复制的房间链接。"); }
    if (url.origin !== connection.invitation.hostOrigin || url.username || url.password || url.hash ||
      [...url.searchParams.keys()].some(key => !roomLinkKeys.has(key)) || url.searchParams.getAll("team").length !== 1 || url.searchParams.get("team") !== scope.teamId ||
      url.searchParams.getAll("room").length !== 1 || !roomID(url.searchParams.get("room") || "")) {
      throw new Error("房间链接必须属于当前 Host 和 Team，且不能含有登录凭据。");
    }
    return url.searchParams.get("room");
  });
  if (new Set(rooms).size !== rooms.length) throw new Error("请删除重复的房间链接。");
  return rooms;
}

export function createPeerSharingController({root, request, now = Date.now, newOperationId = peerOperationId}) {
  const document = root.ownerDocument, c = name => root.querySelector(`[data-sharing-${name}]`);
  const dialog = c("dialog"), withdrawal = c("withdraw-dialog");
  let nodeId = "", active = false, epoch = 0, loading = false, busy = false, lastLoad = -Infinity;
  let data = null, shownSource = null, loadError = "", selected = null, review = null, submitted = false, withdraw = null, withdrawalSubmitted = false, fingerprint = "";
  const make = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const details = rows => { const dl = make("dl", undefined, "peer-details"); for (const [key, value] of rows) { const row = make("div"); row.append(make("dt", key), make("dd", value)); dl.append(row); } return dl; };
  const button = (text, action, key) => { const node = make("button", text, "secondary"); node.type = "button"; node.dataset.sharingAction = ""; node.dataset.sharingKey = key; node.addEventListener("click", action); return node; };
  const connection = () => data?.state.connections.find(value => value.membership.membershipId === selected);
  const available = value => value?.state === "active" && value.membership.state === "active" && Date.parse(value.membership.expiresAt) > now();
  const source = () => data?.sources.find(value => value.localAgentId === c("agent").value);
  const scopeName = value => value.invitation.scope.kind === "room" ? `${value.invitation.teamLabel} / ${value.invitation.roomLabel}` : `${value.invitation.teamLabel} · 指定房间`;
  const sameReview = () => Boolean(review && data?.configurationAvailable && data.state.revision === review.expectedRevision &&
    connection() && available(connection()) && source()?.available && source().configurationDigest === review.configurationDigest &&
    Date.parse(review.request.expiresAt) > now());
  const restoreFocus = key => [...root.querySelectorAll("[data-sharing-key]")].find(node => node.dataset.sharingKey === key)?.focus();
  function clearShare(restore = true) {
    const target = `share:${selected}`;
    if (dialog.open) dialog.close();
    selected = review = shownSource = null; submitted = false; c("rooms").value = ""; c("agent").replaceChildren();
    for (const name of ["source", "review", "error", "scope"]) c(name).replaceChildren();
    c("choices").hidden = false; controls(); if (restore) restoreFocus(target);
  }
  function clearWithdrawal(restore = true) {
    const target = `withdraw:${withdraw?.exportId}`;
    if (withdrawal.open) withdrawal.close();
    withdraw = null; withdrawalSubmitted = false; c("withdraw-details").replaceChildren(); c("withdraw-error").textContent = "";
    if (restore) restoreFocus(target);
  }
  function retire() {
    epoch++; data = null; loading = busy = false; lastLoad = -Infinity; fingerprint = "";
    clearShare(false); clearWithdrawal(false); c("inventory").replaceChildren(); c("result").textContent = "";
  }
  function controls() {
    for (const node of root.querySelectorAll("[data-sharing-action]")) node.disabled = busy || !active || !nodeId;
    c("refresh").disabled = loading || !active || !nodeId;
    c("review-submit").disabled = busy || !active || !data?.configurationAvailable || !available(connection()) || !source()?.available || !source()?.capabilities.supportsStart;
    c("confirm").hidden = !review;
    c("review-submit").hidden = Boolean(review);
    c("back").hidden = !review || submitted;
    c("confirm").disabled = busy || !active || !review || (!submitted && !sameReview());
    c("confirm").textContent = submitted ? "重试原分享操作" : "确认分享";
    c("agent").disabled = busy || Boolean(review); c("rooms").disabled = busy || Boolean(review); c("duration").disabled = busy || Boolean(review);
    for (const input of c("source").querySelectorAll("input")) input.disabled = busy || Boolean(review);
    if (review && !submitted && !sameReview()) c("error").textContent = "本机记录、配置或成员关系已变化，请返回重新审阅。";
    c("withdraw-confirm").disabled = busy || !active || !withdraw || (!withdrawalSubmitted && data?.state.revision !== withdraw.expectedRevision);
    c("withdraw-confirm").textContent = withdrawalSubmitted ? "重试原撤回操作" : "确认撤回";
    if (withdraw && !withdrawalSubmitted && data?.state.revision !== withdraw.expectedRevision) c("withdraw-error").textContent = "分享记录已变化，请关闭并重新选择当前版本。";
  }
  function renderSource() {
    const selectedSource = source(); shownSource = selectedSource ? structuredClone(selectedSource) : null; c("source").replaceChildren();
    if (!selectedSource) { c("source").append(make("p", "尚无可分享的 Agent，请先在本机 Agent 页面完成配置。")); return; }
    c("source").append(details([["本机 Agent", selectedSource.name], ["工作区（仅本机）", selectedSource.workspace], ["本机沙箱", selectedSource.sandbox || "由 Runtime 管理"]]));
    for (const [key, label] of Object.entries(capabilityLabels)) if (selectedSource.capabilities[key]) {
      const row = make("label", label, "peer-capability"), input = make("input"); input.type = "checkbox"; input.checked = true; input.dataset.capability = key;
      if (key === "supportsStart") { input.hidden = true; row.hidden = true; }
      row.prepend(input); c("source").append(row);
    }
    controls();
  }
  function openShare(value) {
    if (busy || !active || !data?.configurationAvailable || !available(value)) return;
    clearShare(); selected = value.membership.membershipId;
    c("scope").append(details([["分享至", scopeName(value)], ["Host", value.invitation.hostOrigin], ["成员有效至", new Date(value.membership.expiresAt).toLocaleString()]]));
    c("agent").replaceChildren(...data.sources.filter(value => value.available && value.capabilities.supportsStart).map(value => { const option = make("option", value.name); option.value = value.localAgentId; return option; }));
    c("rooms-label").hidden = value.membership.scope.kind === "room";
    c("duration").value = "86400000"; renderSource(); dialog.showModal(); c("agent").focus(); controls();
  }
  function renderInventory() {
    const next = JSON.stringify([data, loadError, data?.state.connections.map(value => [available(value), value.exports.map(entry => Date.parse(entry.offer.grant.expiresAt) > now())])]);
    if (next === fingerprint) { controls(); return; }
    fingerprint = next;
    const nodes = [];
    if (loadError) nodes.push(make("p", loadError, "peer-error"));
    else if (!data?.state.connections.length) nodes.push(make("p", "加入远端空间后，可在这里分享本机 Agent。", "peer-empty"));
    else {
      if (!data.configurationAvailable) nodes.push(make("p", "当前 Runtime 配置不可用。已有分享仍可撤回；新的分享需要恢复配置后审阅。", "peer-error"));
      for (const value of data.state.connections) {
        const card = make("article", undefined, "peer-space-card"); card.append(make("h4", scopeName(value)), make("p", value.invitation.hostOrigin));
        if (data.configurationAvailable && available(value)) card.append(button("分享本机 Agent", () => openShare(value), `share:${value.membership.membershipId}`));
        if (!value.exports.length) card.append(make("p", "尚未分享 Agent。"));
        for (const entry of value.exports) {
          const grant = entry.offer.grant, acceptance = entry.acceptance?.acceptance;
          const block = make("section", undefined, "peer-export-record");
          block.append(make("h5", entry.offer.displayName), details([["本机授权", grant.state === "revoked" ? "已撤回" : entry.current ? "当前配置下有效" : "当前配置或授权条件不满足"],
            ["授权有效至", new Date(grant.expiresAt).toLocaleString()], ["分享房间", grant.roomIds.join("、")],
            ["Host 回执", !acceptance ? "尚未收到接纳回执" : acceptance.state === "revoked" ? "Host 已撤销接纳" : Date.parse(acceptance.expiresAt) <= now() ? "Host 接纳已过期" : acceptance.exportId !== grant.exportId || acceptance.grantRevision !== grant.revision ? "回执属于旧的分享版本" : "Host 已接纳此版本"],
            ["双方授权范围", entry.effectiveRoomIds?.length ? entry.effectiveRoomIds.join("、") : "当前没有同时生效的房间"]]));
          block.append(make("p", "依据本机已保存的授权和回执；实际执行还需 Host 当前准入与本机权限。"));
          if (grant.state === "active") block.append(button("撤回此分享", () => {
            if (busy || !active) return;
            withdraw = {expectedRevision: data.state.revision, membershipId: value.membership.membershipId, exportId: grant.exportId, grantRevision: grant.revision, operationId: newOperationId()};
            withdrawalSubmitted = false; c("withdraw-error").textContent = "";
            c("withdraw-details").replaceChildren(details([["Agent", entry.offer.displayName], ["Host", value.invitation.hostOrigin], ["房间", grant.roomIds.join("、")], ["分享版本", `${grant.exportId} · ${grant.revision}`]]));
            withdrawal.showModal(); c("withdraw-cancel").focus(); controls();
          }, `withdraw:${grant.exportId}`));
          card.append(block);
        }
        nodes.push(card);
      }
    }
    const focused = c("inventory").contains(document.activeElement) ? document.activeElement.dataset.sharingKey : null;
    c("inventory").replaceChildren(...nodes); controls();
    if (focused) {
      const replacement = [...root.querySelectorAll("[data-sharing-key]")].find(node => node.dataset.sharingKey === focused);
      (replacement ?? c("refresh")).focus();
    }
  }
  async function refresh() {
    if (!active || !nodeId || loading) return;
    const current = epoch; loading = true; lastLoad = now(); controls();
    try {
      const value = await request("/api/peers/exports");
      if (current !== epoch) return;
      if (value.state.participant.nodeId !== nodeId) throw new Error("本机身份已变化，请重新打开 Console。");
      data = value; loadError = "";
    } catch (error) {
      if (current !== epoch) return;
      if (error.status === 401) { nodeId = ""; retire(); return; }
      data = null; loadError = error.message || "分享记录读取失败，请刷新。";
    } finally { if (current === epoch) { loading = false; renderInventory(); } }
  }
  async function mutate(path, body, target, complete) {
    if (busy || !active || !nodeId) return;
    const current = epoch; busy = true; target.textContent = "正在处理…"; controls();
    try {
      const result = await request(path, {method: "POST", body: JSON.stringify(body)});
      if (current === epoch) complete(result);
    } catch (error) { if (current === epoch) target.textContent = error.message || "结果尚未确认，请重试原操作。"; }
    finally { if (current === epoch) { busy = false; controls(); await refresh(); } }
  }
  c("agent").addEventListener("change", renderSource);
  c("review-submit").addEventListener("click", () => {
    if (busy || !active || !data?.configurationAvailable || !source()?.available || !available(connection())) return;
    try {
      const value = connection(), selectedSource = source(), capabilities = {supportsResume: false, supportsOwnerPrivateOutput: false};
      if (!shownSource || shownSource.localAgentId !== selectedSource.localAgentId || shownSource.configurationDigest !== selectedSource.configurationDigest) {
        renderSource(); c("error").textContent = "本机配置已变化。请核对更新后的工作区与能力，再审阅分享。"; return;
      }
      for (const key of Object.keys(capabilityLabels)) capabilities[key] = Boolean(c("source").querySelector(`[data-capability="${key}"]`)?.checked);
      const previous = value.exports.find(entry => entry.offer.grant.localAgentId === selectedSource.localAgentId);
      const request = {membershipId: selected, localAgentId: selectedSource.localAgentId, operationId: newOperationId(), roomIds: sharingRooms(c("rooms").value, value), capabilities,
        expiresAt: new Date(Math.min(Date.parse(value.membership.expiresAt), now() + Number(c("duration").value))).toISOString(), replaceLineage: previous?.offer.grant.state === "revoked"};
      review = {expectedRevision: data.state.revision, configurationDigest: selectedSource.configurationDigest, request};
      c("review").replaceChildren(details([["Agent", selectedSource.name], ["Host", value.invitation.hostOrigin], ["房间", request.roomIds.join("、")],
        ["能力", Object.entries(capabilityLabels).filter(([key]) => capabilities[key]).map(([, label]) => label).join("、")], ["有效至", new Date(request.expiresAt).toLocaleString()]]),
        make("p", request.replaceLineage ? "原分享已撤回。确认将创建一份新授权，仍需 Host 接纳。" : "仅创建或更新本机分享授权；Host 接纳后才能进入双方同意的房间执行。"));
      c("choices").hidden = true; c("error").textContent = ""; controls(); c("confirm").focus();
    } catch (error) { c("error").textContent = error.message; }
  });
  c("back").addEventListener("click", () => { if (busy || submitted) return; review = null; c("review").replaceChildren(); c("error").textContent = ""; c("choices").hidden = false; renderSource(); });
  c("confirm").addEventListener("click", () => {
    if (busy || !review || (!submitted && !sameReview())) return;
    submitted = true;
    void mutate("/api/peers/exports", review, c("error"), () => { clearShare(); c("result").textContent = "本机分享授权已保存，Host 接纳状态请查看回执。"; });
  });
  c("withdraw-confirm").addEventListener("click", () => {
    if (busy || !withdraw || (!withdrawalSubmitted && data?.state.revision !== withdraw.expectedRevision)) return;
    withdrawalSubmitted = true;
    void mutate("/api/peers/exports/withdraw", withdraw, c("withdraw-error"), () => { clearWithdrawal(); c("result").textContent = "本机分享已撤回，新的执行已被本机阻止。Host 回执会单独同步。"; });
  });
  c("refresh").addEventListener("click", () => void refresh());
  for (const [modal, close, name] of [[dialog, clearShare, "close"], [withdrawal, clearWithdrawal, "withdraw-cancel"]]) {
    c(name).addEventListener("click", close);
    modal.addEventListener("cancel", event => { event.preventDefault(); close(); });
    modal.addEventListener("keydown", event => {
      if (event.key !== "Tab") return;
      const nodes = [...modal.querySelectorAll("button,input,textarea,select")].filter(node => !node.disabled && !node.hidden && !node.closest("[hidden]"));
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
    });
  }
  return {render(state) { const next = state?.localNodeId || ""; if (next !== nodeId) { retire(); nodeId = next; } controls(); if (active && nodeId && now() - lastLoad >= 5000) void refresh(); },
    setActive(value) { if (active === value) return; if (!value) retire(); active = value; controls(); if (value) void refresh(); }, refresh,
    dispose() { active = false; nodeId = ""; retire(); }};
}
