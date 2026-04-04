import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("subagent-team agent prompt scopes coordinator defaults to the main session", () => {
  const prompt = readRepoFile("skills/openspec-subagent-team/agents/openai.yaml");

  assert.match(prompt, /only when this session is the main coordinator session/);
  assert.match(prompt, /first openspec-extensions skill activation/);
  assert.match(prompt, /best-effort non-blocking version check/);
  assert.match(prompt, /openspec\/openspec-extensions\.json/);
  assert.match(prompt, /repo-recorded plugin version/);
  assert.match(prompt, /npm update -g openspec-extensions/);
  assert.match(prompt, /openspec-ex install --target-repo \/path\/to\/your\/project --force --force-config/);
  assert.match(prompt, /explicit seat-local handoff or role instruction/);
  assert.match(prompt, /do not apply serial fallback/);
  assert.match(prompt, /rendered seat-handoff artifact exists/);
  assert.match(prompt, /seat-handoff artifact or the exact seat section from it/);
  assert.match(prompt, /do not fork the full coordinator thread or full chat history/);
  assert.match(prompt, /do not repeat the version reminder there/);
  assert.match(prompt, /do not self-certify the gate/);
});

test("chat-router agent prompt does not reroute spawned seat sessions", () => {
  const prompt = readRepoFile("skills/openspec-chat-router/agents/openai.yaml");

  assert.match(prompt, /only for the main user-facing or coordinator session/);
  assert.match(prompt, /first openspec-extensions skill activation/);
  assert.match(prompt, /best-effort non-blocking version check/);
  assert.match(prompt, /openspec\/openspec-extensions\.json/);
  assert.match(prompt, /repo-recorded plugin version/);
  assert.match(prompt, /npm update -g openspec-extensions/);
  assert.match(prompt, /openspec-ex install --target-repo \/path\/to\/your\/project --force --force-config/);
  assert.match(prompt, /explicit seat-local spawned-subagent handoff/);
  assert.match(prompt, /do not apply coordinator fallback rules/);
  assert.match(prompt, /do not fork the full coordinator thread\/context into them/);
  assert.match(prompt, /do not repeat the version reminder there/);
  assert.match(prompt, /你自己判断复杂度, 复杂时自动启用 subagent-team/);
});

test("mode cheat sheet includes unattended kickoff with explicit model and requirement placeholders", () => {
  const template = readRepoFile("skills/openspec-chat-router/references/router/mode-cheatsheet.md");

  assert.match(template, /创建新 change/);
  assert.match(template, /subagent-team/);
  assert.match(template, /<指定模型>/);
  assert.match(template, /需求：<需求描述>/);
});

test("chat-router skill defines explainable complexity triage before choosing simple or complex flow", () => {
  const skill = readRepoFile("skills/openspec-chat-router/SKILL.md");

  assert.match(skill, /## Complexity Triage/);
  assert.match(skill, /0-1/);
  assert.match(skill, /2-3/);
  assert.match(skill, /4\+/);
  assert.match(skill, /Existing issue artifacts on disk override a fresh simple-flow guess; reconcile first/);
  assert.match(skill, /explicitly upgrade to the complex flow and state why/);
  assert.match(skill, /complex -> auto subagent-team/);
});

test("mode cheat sheet includes auto-subagent authorization wording for complex flow", () => {
  const template = readRepoFile("skills/openspec-chat-router/references/router/mode-cheatsheet.md");

  assert.match(template, /自动启用 subagent-team 推进，不用再单独问我/);
  assert.match(template, /如需 spawned subagent，请显式使用 `<指定模型>`/);
});

test("all installable skills define the same non-blocking update reminder", () => {
  const skillPaths = [
    "skills/openspec-chat-router/SKILL.md",
    "skills/openspec-dispatch-issue/SKILL.md",
    "skills/openspec-execute-issue/SKILL.md",
    "skills/openspec-plan-issues/SKILL.md",
    "skills/openspec-reconcile-change/SKILL.md",
    "skills/openspec-subagent-team/SKILL.md"
  ];

  for (const skillPath of skillPaths) {
    const skill = readRepoFile(skillPath);

    assert.match(skill, /首次触发任一 `openspec-extensions` skill/);
    assert.match(skill, /非阻塞版本检查/);
    assert.match(skill, /openspec\/openspec-extensions\.json/);
    assert.match(skill, /仓库记录版本/);
    assert.match(skill, /npm update -g openspec-extensions/);
    assert.match(skill, /openspec-ex install --target-repo \/path\/to\/your\/project --force --force-config/);
    assert.match(skill, /当前流程继续，不受这条提醒影响/);
  }
});

test("team templates require seat contracts to override inherited coordinator context", () => {
  const template = readRepoFile("skills/openspec-subagent-team/references/team-templates.md");

  assert.match(template, /Seat override policy:/);
  assert.match(template, /以 seat-local handoff 为准/);
  assert.match(template, /fork_context=false/);
  assert.match(template, /inherited context 泄漏/);
  assert.match(template, /不能自行启用 serial fallback/);
});
