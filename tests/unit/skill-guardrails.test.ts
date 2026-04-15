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
  assert.match(prompt, /Only treat control-plane artifacts under `openspec\/changes\/<change>\/\.\.\.` as workflow state/);
  assert.match(prompt, /task_plan\.md/);
  assert.match(prompt, /continuation_policy\.mode=continue_immediately/);
  assert.match(prompt, /do not stop at `control-plane ready`/);
  assert.match(prompt, /do not self-certify the gate/);
  assert.match(prompt, /keep the main session coordinator-only during issue execution/);
  assert.match(prompt, /Use serial fallback only after explicit evidence that the runtime cannot delegate/);
  assert.match(prompt, /create or reuse that workspace first/);
});

test("chat-router agent prompt does not reroute spawned seat sessions", () => {
  const prompt = readRepoFile("skills/openspec-chat-router/agents/openai.yaml");

  assert.match(prompt, /only for the main user-facing or coordinator session/);
  assert.match(prompt, /进入 openspec 模式/);
  assert.match(prompt, /进入 OpenSpec 模式/);
  assert.match(prompt, /给我 openspec 话术模板/);
  assert.match(prompt, /把命令表打出来/);
  assert.match(prompt, /first openspec-extensions skill activation/);
  assert.match(prompt, /best-effort non-blocking version check/);
  assert.match(prompt, /openspec\/openspec-extensions\.json/);
  assert.match(prompt, /repo-recorded plugin version/);
  assert.match(prompt, /npm update -g openspec-extensions/);
  assert.match(prompt, /openspec-ex install --target-repo \/path\/to\/your\/project --force --force-config/);
  assert.match(prompt, /treat that as the `mode` path/);
  assert.match(prompt, /print the compact OpenSpec mode cheat sheet and recommended kickoff wording/);
  assert.match(prompt, /stop unless I included another concrete OpenSpec request in the same message/);
  assert.match(prompt, /explicit seat-local spawned-subagent handoff/);
  assert.match(prompt, /do not apply coordinator fallback rules/);
  assert.match(prompt, /do not fork the full coordinator thread\/context into them/);
  assert.match(prompt, /do not repeat the version reminder there/);
  assert.match(prompt, /你自己判断复杂度, 复杂时自动启用 subagent-team/);
  assert.match(prompt, /issue-mode artifacts already exist/);
  assert.match(prompt, /higher priority than generic implementation wording/);
  assert.match(prompt, /reconcile first and continue the subagent-team main path/);
  assert.match(prompt, /Selecting the complex flow does not authorize main-session implementation/);
  assert.match(prompt, /keep the main session coordinator-only/);
  assert.match(prompt, /do not use the serial issue fallback just because the current issue looks manageable/);
  assert.match(prompt, /create or reuse that workspace before rendering issue\/team dispatch or starting implementation/);
  assert.match(prompt, /Only treat control-plane artifacts under `openspec\/changes\/<change>\/\.\.\.` as workflow state/);
  assert.match(prompt, /task_plan\.md/);
  assert.match(prompt, /continuation_policy/);
  assert.match(prompt, /do not stop at a chat summary/);
});

test("chat-router skill metadata includes the spaced OpenSpec mode trigger", () => {
  const skill = readRepoFile("skills/openspec-chat-router/SKILL.md");

  assert.match(skill, /“进入openspec模式”/);
  assert.match(skill, /“进入 openspec 模式”/);
});

test("mode cheat sheet includes unattended kickoff with explicit model and requirement placeholders", () => {
  const template = readRepoFile("skills/openspec-chat-router/references/router/mode-cheatsheet.md");

  assert.match(template, /常用的话术模版/);
  assert.match(template, /创建新需求/);
  assert.match(template, /继续 <change> change/);
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
  assert.match(skill, /mandatory gate before implementation/);
  assert.match(skill, /Existing issue artifacts on disk override a fresh simple-flow guess; reconcile first/);
  assert.match(skill, /A `2-3` borderline result is not implementation authorization/);
  assert.match(skill, /keep that route sticky across later "start implementing" or "continue coding" messages/);
  assert.match(skill, /Do not keep going as a simple local `apply` path just because the task still looks manageable in one session/);
  assert.match(skill, /immediately restate a route decision/);
  assert.match(skill, /control\/ROUTE-DECISION\.json/);
  assert.match(skill, /complex flow is a routing decision, not implementation authorization/);
  assert.match(skill, /do not start implementation, do not run scaffolding or app-bootstrap commands/);
  assert.match(skill, /runs\/ISSUE-PLANNING\.json/);
  assert.match(skill, /Before final completion, audit whether the selected route was actually followed/);
  assert.match(skill, /explicitly upgrade to the complex flow and state why/);
  assert.match(skill, /complex -> auto subagent-team/);
  assert.match(skill, /Do not activate the main-session serial fallback just because the current issue looks manageable/);
  assert.match(skill, /the main session remains coordinator-only during issue execution/);
});

test("issue-mode contract includes persisted route decision artifact", () => {
  const contract = readRepoFile("skills/openspec-chat-router/references/issue-mode-contract.md");

  assert.match(contract, /ROUTE-DECISION\.json/);
  assert.match(contract, /Complexity triage for a concrete change should be written to `control\/ROUTE-DECISION\.json`/);
  assert.match(contract, /Only issue-mode artifacts under `openspec\/changes\/<change>\/\.\.\.` count as workflow state/);
  assert.match(contract, /task_plan\.md/);
  assert.match(contract, /After an external disconnect or fresh reconnect/);
});

test("reconcile skill resume rules ignore repo-root helper noise and honor continuation policy", () => {
  const skill = readRepoFile("skills/openspec-reconcile-change/SKILL.md");

  assert.match(skill, /Only treat control-plane artifacts under `openspec\/changes\/<change>\/\.\.\.` as issue-mode workflow state/);
  assert.match(skill, /task_plan\.md/);
  assert.match(skill, /continuation_policy\.mode=continue_immediately/);
  assert.match(skill, /external disconnect or a fresh reconnect/);
});

test("coordinator playbook forbids implementation before complex-flow gates pass", () => {
  const playbook = readRepoFile("skills/openspec-chat-router/references/router/coordinator-playbook.md");

  assert.match(playbook, /immediately restate a route decision/);
  assert.match(playbook, /Before `runs\/SPEC-READINESS\.json` is current and passed, do not start implementation/);
  assert.match(playbook, /do not run scaffolding or bootstrap commands/);
  assert.match(playbook, /Before the first issue execution, require both a current passed `runs\/ISSUE-PLANNING\.json` and the coordinator-owned planning-doc commit/);
  assert.match(playbook, /keep the main session coordinator-only during issue execution/);
  assert.match(playbook, /do not activate serial fallback just because the task still looks manageable in one main session/);
  assert.match(playbook, /Once that review passes, run the required automated test\/validation plus automated manual verification closeout/);
  assert.match(playbook, /prefer chrome devtools MCP/);
});

test("router examples and cheat sheet keep issue-mode state above generic apply wording", () => {
  const examples = readRepoFile("skills/openspec-chat-router/references/router/examples.md");
  const template = readRepoFile("skills/openspec-chat-router/references/router/mode-cheatsheet.md");

  assert.match(examples, /已经拆过 issue，现在开始实现/);
  assert.match(examples, /reconcile`, then continue through `subagent-team`/);
  assert.match(examples, /apply` when the change has not entered issue-mode yet/);
  assert.match(template, /先做显式复杂度 triage/);
  assert.match(template, /`2-3` 分是边界态，不是开始实现的授权/);
  assert.match(template, /这些磁盘工件比“开始做 \/ 开始实现 \/ 直接落地”这类聊天话术优先级更高/);
  assert.match(template, /路由决议：复杂流。我将按 subagent-team 协调推进/);
  assert.match(template, /不要因为“开始实现”这类泛化话术退回 apply/);
});

test("mode cheat sheet includes auto-subagent authorization wording for complex flow", () => {
  const template = readRepoFile("skills/openspec-chat-router/references/router/mode-cheatsheet.md");

  assert.match(template, /自动启用 subagent-team 推进，不用再单独问我/);
  assert.match(template, /如需 spawned subagent，请显式使用 `<指定模型>`/);
  assert.match(template, /review 通过后，必须补齐自动化测试\/校验和自动化手工验证/);
  assert.match(template, /优先使用 chrome devtools MCP/);
});

test("closeout guardrails require post-review automation and prefer chrome devtools MCP for frontend", () => {
  const readme = readRepoFile("README.md");
  const routerSkill = readRepoFile("skills/openspec-chat-router/SKILL.md");
  const teamSkill = readRepoFile("skills/openspec-subagent-team/SKILL.md");
  const contract = readRepoFile("skills/openspec-chat-router/references/issue-mode-contract.md");
  const issueModeConfig = readRepoFile("skills/openspec-chat-router/references/issue-mode-config.md");

  assert.match(readme, /review 通过后，必须补齐自动化测试\/校验和自动化手工验证/);
  assert.match(readme, /优先使用 chrome devtools MCP/);
  assert.match(readme, /你自己判断需求复杂度；如果属于复杂流程，自动启用 subagent-team 推进，不用再单独问我/);
  assert.match(readme, /继续 <change> change，根据原来判断的复杂度继续/);
  assert.match(routerSkill, /review current code -> automated test\/validation \+ automated manual verification -> `verify` -> `archive`/);
  assert.match(routerSkill, /After that review passes, run the required automated test\/validation plus automated manual verification/);
  assert.match(teamSkill, /change-level `\/review` has passed/);
  assert.match(teamSkill, /prefer chrome devtools MCP/);
  assert.match(contract, /After that review passes, complex flow keeps the final automated test\/validation and automated manual verification/);
  assert.match(contract, /chrome devtools MCP/);
  assert.match(issueModeConfig, /full_auto/);
  assert.match(issueModeConfig, /automated-test closeout/);
  assert.match(issueModeConfig, /stop before verify \/ archive/);
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
