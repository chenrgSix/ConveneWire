// Only the authenticated native Console renders source metadata. Never use HTML
// interpolation for conversation titles, workspace paths, or tool names.
export function createDesktopHandoffController({root, request}) {
  const document = root.ownerDocument;
  let active = false, disposed = false, busy = false, generation = 0, state, timer, notice = "";
  function node(tag, text, className) {
    const item = document.createElement(tag);
    if (text) item.textContent = text;
    if (className) item.className = className;
    return item;
  }
  function button(text, action, primary = false) {
    const item = node("button", text, primary ? "primary" : "secondary");
    item.type = "button"; item.disabled = busy; item.addEventListener("click", action); return item;
  }
  function row(label, value) {
    const item = node("div", null, "handoff-row");
    item.append(node("span", label), node("strong", value)); return item;
  }
  async function refresh() {
    const current = ++generation;
    try {
      const next = await request("/api/desktop-codex");
      if (disposed || !active || current !== generation) return;
      state = next; render();
    } catch (error) {
      if (disposed || current !== generation) return;
      notice = error.message ?? String(error); render();
    }
  }
  async function act(action, extra = {}) {
    if (busy) return;
    busy = true; notice = ""; render();
    try {
      await request("/api/desktop-codex", {method: "POST", body: JSON.stringify({action, taskId: state?.taskId ?? "", ...extra})});
      notice = action === "setup" ? "启动入口已准备。请自行退出 Codex 后，再从这里启动。" : action === "confirm" ? "已接管。返回本地空间，在这个任务的房间输入下一条消息即可。" : action === "release" ? "已交回 Codex，可继续原会话。" : "";
    } catch (error) { notice = error.message ?? String(error); }
    finally { busy = false; if (!disposed) await refresh(); }
  }
  function render() {
    root.replaceChildren();
    const heading = node("div", null, "page-heading");
    const copy = node("div"); copy.append(node("p", "继续你的工作", "eyebrow"), node("h2", "把原来的 Codex 会话交给房间"), node("p", "保留会话 ID、历史和工作区；结束后可交回 Codex。"));
    heading.append(copy, button("刷新", refresh)); root.append(heading);
    if (notice) { const status = node("p", notice, "handoff-notice"); status.setAttribute("role", "status"); root.append(status); }
    if (!state) return;
    if (state.supported === false) { root.append(node("p", "当前协作启动入口仅支持 macOS；此设备尚不能接管 Codex 桌面会话。")); return; }
    if (!state.connected) {
      const card = node("section", null, "settings-card");
      card.append(node("h3", "先连接 Codex 桌面应用"), node("p", "首次使用需要通过协作入口启动 Codex。请保存当前工作并自行退出；这里不会关闭你的任务，也不会安装另一个 Codex。"));
      const actions = node("div", null, "actions"); actions.append(button("准备协作入口", () => act("setup")), button("启动 Codex", () => act("launch"), true)); card.append(actions);
      card.append(node("p", "启动后，在 Codex 打开要交给房间的会话，等它空闲，再回到这里刷新。日后直接打开原 Codex 应用即可恢复普通启动。")); root.append(card);
    }
    if (!state.scope) {
      root.append(node("p", "从本地空间的任务详情选择“连接已有 Codex 会话”。目标需要是分配给本机 Codex Agent 的新任务。"));
      for (const saved of state.bindings ?? []) {
        const item = node("section", null, "settings-card");
        item.append(node("h3", saved.scope.taskTitle), node("p", saved.scope.roomName), button("管理已有接管", () => act("select", {taskId:saved.scope.taskId}))); root.append(item);
      }
      return;
    }
    const destination = node("section", null, "settings-card");
    destination.append(node("h3", "目标与共享范围"), row("房间", state.scope.roomName), row("任务", state.scope.taskTitle), row("Agent", state.scope.agentName), row("可以看到后续回复", state.scope.audience.join("、")));
    root.append(destination);
    const adoption = state.adoption;
    if (adoption && adoption.state !== "released") {
      const card = node("section", null, "settings-card");
      const labels = {reviewed: "确认原会话", confirming: "确认结果待核对", attached: "房间已接管", running: "正在执行", paused: "接管已暂停", releasing: "交回确认未完成，请重试"};
      card.append(node("h3", labels[adoption.state] ?? "需要核对"));
      const source = adoption.review.thread;
      card.append(row("会话", source.title || source.threadId), row("工作区", source.workspace), row("模型", `${source.provider} / ${source.model}`), row("本次执行权限", adoption.sandbox === "workspace-write" ? "可写当前工作区 · 禁止自动提权 · 无网络" : "只读 · 禁止自动提权"));
      const details = node("details"); details.append(node("summary", "原会话 ID 与已有工具"), node("code", source.threadId), node("p", source.tools?.length ? source.tools.join("、") : "未配置动态工具 / MCP 工具")); card.append(details);
      if (adoption.unsettled) card.append(node("p", "上一条提交尚未确认。不会自动重发；请先核对原会话的执行结果。"));
      if (adoption.state === "reviewed") {
        const label = node("label", null, "handoff-consent"); const check = node("input"); check.type = "checkbox";
        const confirm = button("确认并交给房间", () => act("confirm", {reviewId: adoption.reviewId, disclose: check.checked}), true); confirm.disabled = true;
        check.addEventListener("change", () => { confirm.disabled = busy || !check.checked; });
        label.append(check, node("span", "我确认此会话的历史可能影响房间后续回复，并同意使用上方已有工具。若上一条执行状态未确认，我已在原会话核对，不要求重发。工具可能访问原先连接的外部服务；本次确认仅适用于当前任务和共享范围。")); card.append(label, confirm);
      }
      if (adoption.state === "paused" && state.connected) card.append(button("重新核对并接管", () => act("review", {threadId: source.threadId})));
      card.append(button(adoption.state === "reviewed" ? "取消接管" : "交回 Codex", () => act("release")));
      root.append(card);
      return;
    }
    if (adoption?.state === "released" || state.scope.state === "released") { root.append(node("p", "此任务的会话已交回 Codex。再次接管请新建任务，旧任务不会另起会话。")); return; }
    if (state.connected) {
      const list = node("section", null, "settings-card"); list.append(node("h3", "选择已打开的会话"));
      if (!state.threads.length) list.append(node("p", "暂未发现会话。请在通过协作入口启动的 Codex 中打开目标会话，再刷新。"));
      for (const thread of state.threads) {
        const item = node("article", null, "handoff-thread"); const text = node("div");
        text.append(node("strong", thread.title || "未命名会话"), node("p", thread.workspace));
        const select = button(thread.busy ? "正在使用" : "查看并确认", () => act("review", {threadId: thread.threadId})); select.disabled = busy || thread.busy;
        item.append(text, select); list.append(item);
      }
      root.append(list);
    }
  }
  return {
    setActive(value) {
      active = value; clearInterval(timer);
      if (value) { void refresh(); timer = setInterval(() => { if (!busy && state?.adoption?.state !== "reviewed") void refresh(); }, 5000); }
      else generation++;
    },
    dispose() { disposed = true; generation++; clearInterval(timer); }
  };
}
