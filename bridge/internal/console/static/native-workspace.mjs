// Presentation only: native Owner authorization remains in the existing service.
// No Hub origin, return URL or credential is accepted by this controller.
export function createNativeWorkspace({document, query}) {
  const requested = query.get("workspace") === "1";
  const page = ["agents", "peers", "handoff"].includes(query.get("page")) ? query.get("page") : "agents";
  const theme = query.get("theme") === "light" ? "light" : "dark";
  const header = document.getElementById("workspace-settings-header");
  const empty = document.getElementById("workspace-agent-empty");
  function activate(active) {
    document.body.classList.toggle("native-workspace", active);
    header.classList.toggle("hidden", !active);
    if (active && document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
  }
  // Avoid flashing legacy enrollment while the authenticated state is loading.
  activate(requested);
  if (requested) {
    document.title = "ConveneWire · 本机 Agent";
    document.getElementById("page-context").textContent = "本地空间 / 设置";
    document.getElementById("page-title").textContent = "本机 Agent";
  }
  return {
    address: requested ? `/?workspace=1&theme=${theme}${page !== "agents" ? `&page=${page}` : ""}${query.get("handoff") === "1" ? "&handoff=1" : ""}` : null,
    initialPage: requested ? query.get("handoff") === "1" ? "handoff" : page : "overview",
    render(state) {
      const active = requested && Boolean(state.localNodeId);
      activate(active);
      empty.classList.toggle("hidden", !active || state.agents.length > 0);
      if (active) {
        document.title = "ConveneWire · 本机设置";
        document.getElementById("workspace-runtime-state").textContent = state.bridgeRunning ? "本机运行服务已启动" : "本机运行服务已停止";
      }
      return active;
    }
  };
}
