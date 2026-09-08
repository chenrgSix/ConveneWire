const list = (text) => [...new Set(String(text).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean))];
const pin = (value) => ({profileId: value.profileId ?? value.spec.profileId, revision: value.revision ?? value.spec.revision, digest: value.digest});

export function workPolicySpec(values, inventory, policyId) {
  const binding = inventory.bindings?.find((value) => value.bindingId === values.bindingId && !value.revokedAt);
  const runtime = inventory.runtimeProfiles?.find((value) => value.spec.profileId === values.runtimeProfileId &&
    value.spec.agentId === values.agentId && !value.revokedAt);
  const verifiers = values.verifierIds.map((id) => inventory.verificationProfiles?.find((value) => value.profileId === id && !value.revokedAt));
  if (!binding || !runtime || !verifiers.length || verifiers.some((value) => !value)) throw new Error("本机资源已变化，请刷新并重新选择。");
  if (!values.confirmed) throw new Error("请先确认工作范围。");
  return {
    policyId, alias: values.alias.trim(), bindingId: binding.bindingId, bindingRevision: binding.revision,
    sourceFingerprint: binding.sourceFingerprint, repositoryId: binding.repositoryId,
    sourceRef: values.sourceRef.trim(), agentId: values.agentId, roomIds: values.roomIds,
    initiatorMemberIds: list(values.initiatorMemberIds), operations: ["prepare", "capture", "verify"],
    runtimeProfile: pin(runtime), verificationProfiles: verifiers.map(pin),
    scopePolicy: {access: "isolated_write", allowedPaths: list(values.allowedPaths), forbiddenPaths: list(values.forbiddenPaths),
      requirePreventivePathEnforcement: false},
    maxTaskDurationSeconds: Number(values.minutes) * 60, maxRunAttempts: Number(values.attempts), maxConcurrency: 1,
    expiresAt: new Date(values.expiresAt).toISOString()
  };
}

export function createWorkPolicyForm({form, request, agents, refreshed}) {
  let inventory = {};
  let policyId = `workpolicy_${crypto.randomUUID()}`;
  let busy = false;
  const field = (name) => form.elements.namedItem(name);
  const status = form.querySelector("[data-policy-status]");
  const expiry = new Date(Date.now() + 7 * 86400000);
  field("expiresAt").value = new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  function options(name, entries) {
    const select = field(name);
    const previous = new Set([...select.selectedOptions].map((option) => option.value));
    select.replaceChildren(...entries.map(([value, title]) => {
      const option = new Option(title, value); option.selected = previous.has(value); return option;
    }));
  }
  function runtimes() {
    options("runtimeProfileId", (inventory.runtimeProfiles ?? []).filter((profile) => !profile.revokedAt && profile.spec.agentId === field("agentId").value)
      .map((profile) => [profile.spec.profileId, `${profile.spec.permissionProfile} · ${profile.spec.profileId}`]));
  }
  field("agentId").addEventListener("change", runtimes);
  form.addEventListener("input", () => { if (!busy) policyId = `workpolicy_${crypto.randomUUID()}`; });
  form.querySelector("[data-load-rooms]").addEventListener("click", async () => {
    const message = form.querySelector("[data-room-status]");
    message.textContent = "正在读取…";
    try {
      const identity = await request("/api/client-access");
      options("roomIds", identity.rooms.map((room) => [room.roomId, `${room.name} · ${room.roomId}`]));
      if (!field("initiatorMemberIds").value) field("initiatorMemberIds").value = identity.memberId;
      message.textContent = "请选择允许发起开发的 Room。";
    } catch (error) { message.textContent = error.message; }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form));
    values.roomIds = [...field("roomIds").selectedOptions].map((option) => option.value);
    values.verifierIds = [...field("verifierIds").selectedOptions].map((option) => option.value);
    values.confirmed = field("confirmed").checked;
    try {
      const spec = workPolicySpec(values, inventory, policyId);
      busy = true;
      form.querySelectorAll("input,select,textarea,button").forEach((control) => { control.disabled = true; });
      status.textContent = "正在保存策略并更新连接…";
      const receipt = await request("/api/work-policies", {method: "POST", body: JSON.stringify({spec, confirm: true})});
      field("confirmed").checked = false;
      policyId = `workpolicy_${crypto.randomUUID()}`;
      await refreshed();
      status.textContent = receipt.reconnectRequired ? "策略已保存。连接恢复失败，请在概览中重新启动 Bridge。" : "策略已保存。允许的成员现在可从 Room 发起开发任务。";
    } catch (error) { status.textContent = error.message; }
    finally {
      busy = false;
      form.querySelectorAll("input,select,textarea,button").forEach((control) => { control.disabled = false; });
    }
  });
  return {
    render(state) {
      inventory = state;
      options("bindingId", (state.bindings ?? []).filter((binding) => !binding.revokedAt).map((binding) => [binding.bindingId, binding.alias]));
      options("agentId", agents().filter((agent) => agent.kind === "codex" && !agent.ownerPrivateOutput).map((agent) => [agent.agentId, agent.name]));
      runtimes();
      options("verifierIds", (state.verificationProfiles ?? []).filter((profile) => !profile.revokedAt).map((profile) => [profile.profileId, `${profile.profileId} · 最长 ${profile.timeoutMilliseconds / 1000} 秒`]));
      if (!field("bindingId").options.length || !field("runtimeProfileId").options.length || !field("verifierIds").options.length) {
        status.textContent = "尚无完整的本机资源：请先登记仓库、执行环境和验证方式，再刷新。";
      }
    }
  };
}
