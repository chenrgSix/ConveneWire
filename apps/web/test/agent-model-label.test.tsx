import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentModelLabel, agentModelLabel } from "../src/features/agent/AgentModelLabel.js";
import type { Agent } from "../src/models.js";

const agent = { integrationMode: "managed", presence: "ready", configuredModel: "fixture-default", modelReportedAt: "2026-09-16T03:00:00Z" } as Agent;

test("configured model labels distinguish current configuration, last report and unknown", () => {
  assert.equal(agentModelLabel(agent, "zh-CN"), "配置模型：fixture-default");
  assert.equal(agentModelLabel(agent, "en"), "Configured model: fixture-default");
  assert.equal(agentModelLabel({ ...agent, presence: "offline" }, "zh-CN"), "上次上报模型：fixture-default");
  assert.equal(agentModelLabel({ ...agent, presence: "offline" }, "en"), "Last reported model: fixture-default");
  for (const configuredModel of [null, "", " "]) {
    assert.equal(agentModelLabel({ ...agent, configuredModel }, "zh-CN"), "模型：尚未识别");
    assert.equal(agentModelLabel({ ...agent, configuredModel }, "en"), "Model: not identified");
  }
});

test("model metadata renders its report time without claiming a Run model", () => {
  const html = renderToStaticMarkup(<AgentModelLabel agent={agent} locale="zh-CN" showUpdatedAt />);
  assert.match(html, /配置模型：fixture-default/u);
  assert.match(html, /模型信息更新于/u);
  assert.doesNotMatch(html, /实际模型|Run model/u);
  const unknown = renderToStaticMarkup(<AgentModelLabel agent={{ ...agent, configuredModel: null, modelReportedAt: "invalid" }} locale="en" showUpdatedAt />);
  assert.match(unknown, /Model: not identified/u);
  assert.doesNotMatch(unknown, /Invalid Date|updated at/u);
});
