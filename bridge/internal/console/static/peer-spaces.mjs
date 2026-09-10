const id = (prefix, value) => typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9_-]{8,128}$`, "u").test(value);
const date = (value) => Number.isFinite(Date.parse(value));

export function peerOperationId() {
  return `op_${crypto.randomUUID().replaceAll("-", "")}`;
}

function httpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password;
  } catch { return false; }
}

function validInvitation(value) {
  return value?.schemaVersion === 1 && id("peerinvite", value.invitationId) &&
    id("node", value.host?.nodeId) && /^[A-Za-z0-9_-]{43}$/u.test(value.host?.publicKey || "") &&
    httpsOrigin(value.hostOrigin) && typeof value.teamLabel === "string" && date(value.expiresAt) && date(value.membershipExpiresAt) &&
    id("team", value.scope?.teamId) && (value.scope.kind === "team" ? value.scope.roomId === null
      : value.scope.kind === "room" && id("room", value.scope.roomId) && typeof value.roomLabel === "string");
}

export function parsePeerInvitation(text, operationId, now = Date.now()) {
  if (text.length > 16384) throw new Error("邀请内容过长，请粘贴 Host 提供的完整邀请。");
  let value;
  try { value = JSON.parse(text); } catch { throw new Error("邀请格式无效，请粘贴 Host 提供的完整邀请。"); }
  if (value?.schemaVersion !== 1 || !validInvitation(value.invitation) || !/^[A-Za-z0-9_-]{43}$/u.test(value.secret || "") ||
      !id("op", operationId)) throw new Error("邀请不完整，或 Host 地址不是 HTTPS。");
  const invitation = value.invitation;
  if (Date.parse(invitation.expiresAt) <= now || Date.parse(invitation.membershipExpiresAt) <= now) {
    throw new Error("这份邀请已过期，请向 Host 申请新邀请。");
  }
  return {host: {nodeId: invitation.host.nodeId, publicKey: invitation.host.publicKey}, hostOrigin: invitation.hostOrigin, invitationId: invitation.invitationId,
    secret: value.secret, operationId};
}

export function createPeerSpacesController({root, request, now = Date.now, newOperationId = peerOperationId}) {
  const document = root.ownerDocument;
  const control = (name) => root.querySelector(`[data-peer-${name}]`);
  const inviteDialog = control("invite-dialog");
  const leaveDialog = control("leave-dialog");
  const input = control("invitation");
  const displayName = control("display-name");
  let nodeId = "", active = false, generation = 0, busy = false, loading = false, lastLoad = -Infinity;
  let data = {}, failures = {}, invitation = null, review = null, confirmation = null, leave = null;
  const rendered = new Map();

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(label, action, key) {
    const node = element("button", label, "secondary");
    node.type = "button"; node.dataset.peerMutation = ""; node.dataset.peerKey = key;
    node.addEventListener("click", action);
    return node;
  }
  function details(values) {
    const list = element("dl", undefined, "peer-details");
    for (const [label, value] of values) {
      const row = element("div");
      row.append(element("dt", label), element("dd", value)); list.append(row);
    }
    return list;
  }
  function scopeLabel(invite) {
    return invite.scope.kind === "room" ? `${invite.teamLabel} / ${invite.roomLabel}` : `${invite.teamLabel} · 整个 Team`;
  }
  function invitationDetails(invite) {
    return details([["Host 地址", invite.hostOrigin], ["Host 节点", invite.host.nodeId], ["Host 公钥", invite.host.publicKey],
      ["加入范围", scopeLabel(invite)], ["Team ID", invite.scope.teamId],
      ...(invite.scope.kind === "room" ? [["Room ID", invite.scope.roomId]] : []),
      ["成员有效至", new Date(invite.membershipExpiresAt).toLocaleString()]]);
  }
  function open(dialog, target) {
    dialog.showModal(); target?.focus();
  }
  function closeInvitation() {
    if (inviteDialog.open) inviteDialog.close();
    invitation = review = confirmation = null;
    input.value = ""; displayName.value = "";
    control("invite-details").replaceChildren(); control("invite-error").textContent = "";
    updateControls();
  }
  function closeLeave() {
    if (leaveDialog.open) leaveDialog.close();
    leave = null; control("leave-details").replaceChildren(); control("leave-error").textContent = "";
  }
  function retire() {
    generation++; loading = busy = false; lastLoad = -Infinity; data = {}; failures = {}; rendered.clear();
    closeInvitation(); closeLeave();
    for (const name of ["spaces", "joins", "departures", "status", "result"]) control(name).replaceChildren();
  }
  function updateControls() {
    for (const node of root.querySelectorAll("[data-peer-mutation]")) node.disabled = busy || !active || !nodeId;
    control("refresh").disabled = loading || !active || !nodeId;
    input.disabled = busy || Boolean(invitation);
    displayName.disabled = busy || Boolean(confirmation);
    control("preview").hidden = Boolean(review);
    control("preview").textContent = invitation ? "重试验证邀请" : "验证并查看范围";
    control("join").hidden = !review;
    control("join").textContent = confirmation ? "重试原加入操作" : "确认加入此空间";
    control("join").disabled ||= !review || (!confirmation && (Date.parse(review.invitation.expiresAt) <= now() || !displayName.value.trim() || [...displayName.value.trim()].length > 80));
    control("invite-note").textContent = confirmation
      ? "加入结果尚未确认时请重试原操作。关闭后也可在待恢复列表中查询结果。"
      : review ? "加入只建立成员关系。分享本机 Agent 需要你另行选择，并由 Host 接纳。" : "邀请只发给本机 Console 验证；请核对验证后的 Host 与空间范围。";
  }
  function list(name, values, renderRow, empty) {
    const fingerprint = JSON.stringify([values, failures[name],
      name === "spaces" ? [values?.map(value => Date.parse(value.membership.expiresAt) <= now()), data.departures] : null,
      name === "status" ? data.status : null]);
    if (rendered.get(name) === fingerprint) return;
    rendered.set(name, fingerprint);
    const nodes = failures[name] ? [element("p", failures[name], "peer-error")]
      : (values || []).length ? values.map(renderRow) : [element("p", empty, "peer-empty")];
    control(name).replaceChildren(...nodes);
  }
  function renderLists() {
    list("spaces", data.spaces?.connections, (connection) => {
      const {invitation: invite, membership} = connection;
      const row = element("article", undefined, "peer-space-card");
      const ended = connection.state !== "active" || membership.state !== "active" || Date.parse(membership.expiresAt) <= now();
      row.append(element("h4", scopeLabel(invite)), element("p", invite.hostOrigin),
        element("p", connection.state === "left" ? "已在本机离开" : ended ? "成员关系不可用" : "已加入 · 访问和任务仍需当前授权"),
        details([["成员关系", membership.membershipId], ["有效至", new Date(membership.expiresAt).toLocaleString()]]));
      if (connection.state !== "left" && !data.departures?.departures.some(value => value.intent.membershipId === membership.membershipId)) {
        row.append(button("离开此空间", () => {
          if (busy || !active) return;
          leave = {membershipId: membership.membershipId, operationId: newOperationId()};
          control("leave-details").replaceChildren(invitationDetails(invite));
          control("leave-error").textContent = "";
          open(leaveDialog, control("leave-cancel")); updateControls();
        }, `leave:${membership.membershipId}`));
      }
      return row;
    }, "尚未加入远端空间。可粘贴 Host 发来的邀请。");
    list("joins", data.joins?.pending, (pending) => {
      const row = element("article", undefined, "peer-space-card");
      row.append(element("h4", scopeLabel(pending.invitation)), element("p", pending.invitation.hostOrigin),
        element("p", `加入身份：${pending.displayName}`), element("p", `待确认操作：${pending.operationId}`),
        button("恢复加入结果", () => void run(async (current) => {
          await request(`/api/peers/joins/${encodeURIComponent(pending.operationId)}/recover`, {method: "POST", body: "{}"});
          if (current()) control("result").textContent = "已恢复原加入结果。";
        }), `join:${pending.operationId}`));
      return row;
    }, "没有待恢复的加入操作。");
    list("departures", data.departures?.departures, (departure) => {
      const row = element("article", undefined, "peer-space-card");
      row.append(element("h4", departure.intent.hostOrigin), element("p", departure.intent.membershipId),
        element("p", departure.hostState === "confirmed" ? "本机已停用，Host 已确认离开。" : "本机已停用，等待 Host 确认离开。"));
      if (departure.hostState !== "confirmed") row.append(button("查询离开回执", () => void run(async (current) => {
        await request(`/api/peers/departures/${encodeURIComponent(departure.intent.membershipId)}/recover`, {method: "POST", body: "{}"});
        if (current()) control("result").textContent = "Host 已确认原离开操作。";
      }), `departure:${departure.intent.membershipId}`));
      return row;
    }, "没有离开记录。");
    list("status", data.status?.connections, (connection) => {
      const states = {online: "连接在线", connecting: "正在连接", retrying: "等待重连", stopped: "连接已停止", unavailable: "连接不可用"};
      const row = element("p", `${connection.hostOrigin} · ${states[connection.state] || connection.state}`);
      if (connection.errorCode || connection.exportSyncError || connection.runError) row.append(element("span", ` · ${connection.errorCode || connection.exportSyncError || connection.runError}`));
      return row;
    }, data.status?.state === "running" ? "本机协作服务运行中，暂无远端连接。"
      : data.status?.state === "unavailable" ? "本机协作服务不可用，请检查本机状态。" : "本机协作服务尚未运行。");
    updateControls();
  }
  async function refresh() {
    if (!active || !nodeId || loading) return;
    const epoch = generation;
    loading = true; lastLoad = now(); updateControls();
    await Promise.all(["spaces", "joins", "departures", "status"].map(async (name) => {
      try {
        const value = await request(`/api/peers/${name}`);
        if (generation !== epoch) return;
        data[name] = value; delete failures[name];
      } catch {
        if (generation !== epoch) return;
        delete data[name]; failures[name] = "读取失败，请刷新或检查本机状态。";
      }
    }));
    if (generation === epoch) { loading = false; renderLists(); }
  }
  async function run(action, errorTarget = control("result")) {
    if (busy || !active || !nodeId) return;
    const epoch = generation;
    busy = true; errorTarget.textContent = "正在处理…"; updateControls();
    try {
      await action(() => epoch === generation);
      if (epoch === generation) errorTarget.textContent = errorTarget === control("result") ? errorTarget.textContent : "";
    } catch (error) {
      if (epoch === generation) errorTarget.textContent = error.message || "结果尚未确认，请保留原操作。";
    } finally {
      if (epoch === generation) { busy = false; updateControls(); await refresh(); }
    }
  }
  control("refresh").addEventListener("click", () => void refresh());
  control("invite").addEventListener("click", () => {
    if (busy || !active || !nodeId) return;
    closeInvitation(); open(inviteDialog, input); updateControls();
  });
  control("preview").addEventListener("click", () => void run(async (current) => {
    invitation ||= parsePeerInvitation(input.value, newOperationId(), now());
    input.value = ""; updateControls();
    const candidate = await request("/api/peers/invitations/preview", {method: "POST", body: JSON.stringify(invitation)});
    if (!current() || !inviteDialog.open) return;
    if (candidate.operationId !== invitation.operationId || candidate.participant?.nodeId !== nodeId || !validInvitation(candidate.invitation) ||
        candidate.invitation.invitationId !== invitation.invitationId || candidate.invitation.host.nodeId !== invitation.host.nodeId ||
        candidate.invitation.host.publicKey !== invitation.host.publicKey ||
        candidate.invitation.hostOrigin !== invitation.hostOrigin || !/^[a-f0-9]{64}$/u.test(candidate.invitationDigest || "")) {
      throw new Error("邀请验证结果与当前节点或 Host 不匹配，请重新打开邀请。");
    }
    review = candidate;
    control("invite-details").replaceChildren(invitationDetails(review.invitation), details([["本机节点", nodeId],
      ["邀请有效至", new Date(review.invitation.expiresAt).toLocaleString()]]));
    updateControls(); displayName.focus();
  }, control("invite-error")));
  displayName.addEventListener("input", updateControls);
  control("join").addEventListener("click", () => {
    if (!review || (!confirmation && (Date.parse(review.invitation.expiresAt) <= now() || !displayName.value.trim() || [...displayName.value.trim()].length > 80))) return;
    void run(async (current) => {
      confirmation ||= {...invitation, displayName: displayName.value.trim(), reviewedInvitationDigest: review.invitationDigest};
      updateControls();
      const outcome = await request("/api/peers/invitations/confirm", {method: "POST", body: JSON.stringify(confirmation)});
      if (current()) {
        closeInvitation();
        control("result").textContent = outcome.state === "active" && outcome.membership.state === "active" && Date.parse(outcome.membership.expiresAt) > now()
          ? "已加入远端空间。分享本机 Agent 需要单独操作。" : "已确认原加入结果；当前成员关系不可用，请查看空间状态。";
      }
    }, control("invite-error"));
  });
  control("leave-confirm").addEventListener("click", () => {
    if (!leave) return;
    const frozen = {...leave};
    void run(async (current) => {
      const value = await request("/api/peers/departures", {method: "POST", body: JSON.stringify(frozen)});
      if (current()) {
        closeLeave();
        control("result").textContent = value.departure.hostState === "confirmed"
          ? "本机已停用该空间，Host 已确认离开。" : "本机已停用该空间；Host 尚未确认，可稍后查询回执。";
      }
    }, control("leave-error"));
  });
  for (const [dialog, name, close] of [[inviteDialog, "invite-close", closeInvitation], [leaveDialog, "leave-cancel", closeLeave]]) {
    control(name).addEventListener("click", close);
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll("button, input, textarea, select, a[href]")]
        .filter(node => !node.disabled && !node.hidden && !node.closest("[hidden]"));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
  }
  return {
    render(state) {
      const next = state?.localNodeId || "";
      if (nodeId !== next) { retire(); nodeId = next; }
      updateControls();
      if (active && nodeId && now() - lastLoad >= 5000) void refresh();
    },
    setActive(value) {
      if (active === value) return;
      if (!value) retire();
      active = value; updateControls();
      if (value) void refresh();
    },
    refresh,
    dispose() { active = false; nodeId = ""; retire(); }
  };
}
