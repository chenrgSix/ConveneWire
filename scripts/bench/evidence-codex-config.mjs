import { fileURLToPath } from "node:url";

export function evidenceCodexConfig(bundlePath, caseId, receiptDirectory) {
  return [
    'model_reasoning_effort="low"', 'approval_policy="never"', 'web_search="disabled"',
    'tools.view_image=false', 'features.shell_tool=false', 'features.unified_exec=false',
    'features.apps=false', 'features.plugins=false', 'features.remote_plugin=false',
    'features.multi_agent=false', 'features.image_generation=false', 'features.view_image=false',
    'features.skill_search=false', 'features.skill_mcp_dependency_install=false',
    'features.skip_host_skill_discovery=true', 'features.memories=false',
    // This otherwise emits an error-shaped advisory even when startup succeeds.
    'suppress_unstable_features_warning=true',
    `mcp_servers.evidence.command=${JSON.stringify(process.execPath)}`,
    `mcp_servers.evidence.args=${JSON.stringify([
      fileURLToPath(new URL("./evidence-reader.mjs", import.meta.url)), bundlePath, caseId, receiptDirectory
    ])}`,
    'mcp_servers.evidence.enabled_tools=["read_evidence"]',
    'mcp_servers.evidence.required=true'
  ];
}
