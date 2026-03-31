---
name: openspec-chat-router
description: Route natural-language chat or IM requests into the correct OpenSpec workflow step without requiring slash commands. Use when the user wants to drive the OpenSpec change workflow in plain language, such as “进入openspec模式”, “给我 openspec 话术模板”, “列出当前 change 列表”, “起一个变更”, “继续当前 change”, “把文档补齐后开始做”, “检查能不能归档”, “同步 delta spec”, “按 issue 模式继续”, “拆成 issue”, “给我 ISSUE-001 的派发模板”, “直接开 subagent 做 ISSUE-001”, “用 subagent team 推进 ISSUE-001”, “执行 ISSUE-001”, “同步 issue 进度”, or “根据 issue 结果继续推进”.
---

# OpenSpec Chat Router

Use this skill as the natural-language entrypoint for OpenSpec inside this project.
The user should be able to speak normally in chat or IM instead of typing `/opsx:*`.

## Companion Resources

Prefer the project-local companion skill first when the route becomes concrete:

- `../openspec-explore/SKILL.md`
- `../openspec-propose/SKILL.md`
- `../openspec-new-change/SKILL.md`
- `../openspec-ff-change/SKILL.md`
- `../openspec-continue-change/SKILL.md`
- `../openspec-apply-change/SKILL.md`
- `../openspec-plan-issues/SKILL.md`
- `../openspec-dispatch-issue/SKILL.md`
- `../openspec-execute-issue/SKILL.md`
- `../openspec-reconcile-change/SKILL.md`
- `../openspec-subagent-team/SKILL.md`
- `../openspec-verify-change/SKILL.md`
- `../openspec-sync-specs/SKILL.md`
- `../openspec-archive-change/SKILL.md`
- `references/issue-mode-contract.md`
- `references/issue-mode-config.md`
- `references/issue-mode-rra.md`
- `references/router/coordinator-playbook.md`
- `references/router/examples.md`
- `references/router/mode-cheatsheet.md`
- `references/router/issue-mode-template.md`

## Core Rules

- Treat slash commands as internal equivalents, not as a requirement for the user.
- Do not stop at explaining which OpenSpec action matches. Execute the mapped workflow unless blocked.
- Keep the user-facing response natural and brief: first state the action you are taking, then proceed.
- If the user explicitly names a stage or command, that overrides heuristic routing.
- If the user asks to enter OpenSpec mode, print the OpenSpec mode cheat sheet instead of running a workflow stage.
- For large or complex work, prefer issue-based execution plus a change-level review/repair/re-review/acceptance loop rather than one long-running session.
- In issue-based execution, one issue-scoped execution context handles one issue only.
- In issue-mode, default the coordinator entry path to `openspec-subagent-team`.
- In runtimes that support subagents or delegation, prefer the coordinator continuing through the approved issue round with `subagent-team`.
- Use the single-issue `dispatch-issue` / `execute-issue` path only when the user explicitly wants one bounded issue-only subagent, or the current phase has already been narrowed to that one issue.
- The default issue-mode flow is: coordinator enters through `openspec-subagent-team`, creates or reuses approved issue worktrees as needed, drives the current round, then reviews accepted issue output from the main session before merge and commit.
- In multi-session work on the same change, the coordinator session owns `tasks.md`, change-level backlog, merge, commit, `verify`, and `archive`.
- Issue execution subagents must write issue-local progress and run artifacts. They must not directly update `tasks.md`, self-merge, or create the final git commit.
- Before a coordinator continues a change that already has issue artifacts, reconcile issue state from disk first and read change-level control artifacts if present instead of trusting chat memory.
- Use `openspec/issue-mode.json` only for active repo defaults: worktree location, validation commands, worktree creation mode, RRA gate mode, and subagent-team auto-accept switches.
- When delegation is used, explicitly launch the design-author subagent and any code-writing subagent with `reasoning_effort=xhigh`; all other design/planning/check/review/closeout-only subagents should use `reasoning_effort=medium`.
- In subagent-team flow, treat gate-bearing design review / check / review seats as hard barrier participants, not sidecar helpers.
- `auto_accept_*` only skips human chat sign-off after those gate-bearing subagents have finished and their verdicts have been normalized.
- For long-running gate-bearing subagents, prefer blocking waits up to 1 hour instead of short polling.
- Do not launch gate-bearing review/check seats as `explorer`, and do not close them while their phase still depends on their verdicts.
- If the intent is still ambiguous after doing all non-blocked work, ask exactly one short targeted question.

## Intent Routing

| Natural-language intent | Route |
| --- | --- |
| The idea is still fuzzy, they want to discuss, compare, or think first | `explore` |
| They want to quickly start a small change and generate proposal/design/tasks in one go | `propose` |
| They want to create a new change scaffold and inspect the first artifact before continuing | `new` |
| They want to fill all ready artifacts until implementation can start | `ff` |
| They want to resume a change or create the next artifact | `continue` |
| They want to implement, code, land, or continue coding from the change tasks | `apply` |
| They want to split a complex change into issue-sized work packages or create issue docs | `plan-issues` |
| They want to generate the next issue handoff packet, create the issue worktree, or prepare a bounded subagent handoff for one issue | `dispatch-issue` |
| They want to continue a complex change in issue mode and did not explicitly narrow the work to one issue-only subagent | `subagent-team` |
| They explicitly want a subagent team / development-check-review loop for one issue or round | `subagent-team` |
| They want one issue-only subagent to execute a single issue with explicit scope boundaries | `execute-issue` |
| They want to sync issue outputs, collect issue progress, or decide the next coordinator step | `reconcile` |
| They want to verify completeness, readiness, or acceptance before closing the change | `verify` |
| They want to merge delta specs into the main specs | `sync-specs` |
| They want to finish, archive, close out, or收尾 the change | `archive` |
| They want to enter OpenSpec mode, see example phrasing, or view the command mapping | `mode` |
| They want to execute a complex change by issue or see the multi-session template | `issue-mode` |
| They want to know which changes exist or inspect current status | `list` or `status` |

## Default Heuristics

- “没想清楚 / 先聊聊 / 先梳理一下” -> `explore`
- Small task -> `propose` -> `apply` -> review current code -> `verify` -> `archive`
- Large task -> `new` -> `ff` -> `apply` -> review current code -> `verify` -> `archive`
- “继续刚才那个 / 继续这个 change / 下一个文档” -> `continue`
- “开始做 / 开始实现 / 直接落地” -> `apply`
- “拆成 issue / 给出 issue 边界 / 生成 issue 文档” -> `plan-issues`
- “给我 ISSUE-001 的派发模板 / 派发下一个 issue / 给 ISSUE-001 创建 issue worktree / 直接开 subagent 做 ISSUE-001” -> `dispatch-issue`
- “用 subagent team 推进 ISSUE-001 / 开发组检查组审查组一起推进” -> `subagent-team`
- “本会话只处理 ISSUE-001 / 执行这个 issue / subagent 只做 ISSUE-001” -> `execute-issue`
- “同步 issue 进度 / 收敛 issue 状态 / 根据 issue 结果继续推进” -> `reconcile`
- “看看做完没有 / 能不能验收 / 能不能归档” -> `verify`
- “进入 openspec 模式 / 给我 openspec 话术模板 / 把命令表打出来” -> `mode`
- “这个任务很复杂 / 按 issue 模式继续 / 给我多会话模板” -> `issue-mode`，随后默认进入 `subagent-team`

## Complex Change Rules

Preferred flow:

1. Use the main session to get the change to proposal/design-ready state.
2. Run a change-level spec-readiness design review with a dedicated `1` design-author subagent plus `2` design-review subagents, and keep a normalized backlog for that gate.
3. Only after design review passes, split implementation into coordinator-owned `tasks.md` plus issue-sized units with clear boundaries.
4. Review the issue plan before dispatching issue work.
5. For each approved issue, create or reuse the issue worktree (`worker_worktree`) before handoff.
6. By default, render the subagent-team lifecycle packet and use it as the coordinator control packet for the current phase.
7. Use one issue-only execution subagent for one approved issue only when the user explicitly narrows execution to that one issue, or the current step is already a bounded single-issue handoff.
8. After the issue execution subagent reports `review_required`, either let the coordinator review it manually or, when `subagent_team.auto_accept_issue_review=true` and issue-local validation passed, auto-accept/merge/commit it immediately.
9. In every gate-bearing phase, record launched seat ids, wait for completion, normalize the verdicts, and do not advance while any required gate subagent is still running.
10. Repeat for the next approved issue, then run a change-level `/review` plus a change-level acceptance round before `verify` and `archive`.

## Special Path: `mode`

If the user asks to enter OpenSpec mode, print a compact cheat sheet and stop unless they immediately include another concrete OpenSpec request.
Read `references/router/mode-cheatsheet.md`.

## Special Path: `issue-mode`

If the user asks for issue-based multi-session execution, print the issue-mode template and stop unless they already included a concrete change or issue request.
Read `references/router/issue-mode-template.md`.

Rules:

- Tell the user not to keep multiple issues in one long-running session.
- Default the coordinator to the main session.
- Default the coordinator execution entry to `openspec-subagent-team`.
- Remind the user that the coordinator should create or reuse the issue worktree before handing the issue to a bounded execution subagent.
- Remind the user that subagent-team is the default coordinator topology when delegation is available.
- Remind the user that gate-bearing subagents should use up to 1 hour blocking waits, and that auto-accept does not skip waiting for those gate subagents to finish.
- If `subagent_team.auto_accept_*` is enabled, do not describe those phases as waiting for human sign-off.
- If the task artifacts are not ready yet, route to `new`, `propose`, or `ff` before encouraging issue execution contexts.
- If the user is setting up issue-mode for the first time, remind them that issue execution subagents should not touch `tasks.md`.
- Remind the user that issue execution subagents should not merge or commit; the coordinator reviews, merges, and commits after accepting the issue.
- Remind the user that the coordinator should keep change-level backlog and acceptance decisions on disk for complex changes.

## Special Path: `dispatch-issue`

If the user asks for the next issue handoff template, a dispatch prompt, or a copy-paste message for one explicitly narrowed issue-only subagent, prefer `openspec-dispatch-issue`.

Rules:

- dispatch is generated from the issue doc on disk, not improvised from chat memory
- this is the bounded single-issue path, not the default complex-change entry path
- when the runtime supports delegation and the user wants the coordinator to proceed immediately, use the generated dispatch as the input for one spawned issue-only subagent

## Special Path: `subagent-team`

If the user is executing a complex change by issue and has not explicitly narrowed the work to one issue-only subagent, prefer `openspec-subagent-team`.

Summary rule:

- render `ISSUE-*.team.dispatch.md`
- treat `subagent-team` as the default issue-mode coordinator entry
- keep the main agent as control plane owner
- use subagent teams only for the approved round scope
- use role-based launch settings: design-author and code-writing subagents `xhigh`, all other subagents `medium`
- keep gate-bearing review/check subagents alive until their completion states and verdicts are explicitly collected

## Special Path: `reconcile`

If the user asks to sync issue outputs, collect issue progress, or continue a complex change after issue execution artifacts have been written, prefer `openspec-reconcile-change`.

Reconcile is the default first step when:

- `issues/*.progress.json` already exists for the change
- the user says “继续当前 change” after issue-mode work
- the user asks whether the coordinator can continue automatically

## Preferred Issue Execution Path

Read `references/router/coordinator-playbook.md`.

Summary rule:

- `subagent-team` is the default issue-mode coordinator entry
- `dispatch-issue` prepares the issue worktree and source-of-truth dispatch when execution is explicitly narrowed to one issue-only subagent
- reconcile, review, merge, change-level acceptance, verify, and archive stay in the coordinator session

## Preferred Path: Route To The Dedicated Project-Local OpenSpec Skill

- `explore` -> `openspec-explore`
- `propose` -> `openspec-propose`
- `new` -> `openspec-new-change`
- `ff` -> `openspec-ff-change`
- `continue` -> `openspec-continue-change`
- `apply` -> `openspec-apply-change`
- `plan-issues` -> `openspec-plan-issues`
- `dispatch-issue` -> `openspec-dispatch-issue`
- `subagent-team` -> `openspec-subagent-team`
- `execute-issue` -> `openspec-execute-issue`
- `reconcile` -> `openspec-reconcile-change`
- `verify` -> `openspec-verify-change`
- `sync-specs` -> `openspec-sync-specs`
- `archive` -> `openspec-archive-change`

## Fallback Path: Use OpenSpec CLI Directly

If the dedicated skill is unavailable, use the closest OpenSpec CLI flow and continue working:

- `list` -> `openspec list --json`
- `status` -> `openspec status --change "<name>" --json`
- `new` -> `openspec new change "<name>"`, then `openspec status --change "<name>"`
- `propose` or `ff` -> create or select the change, then use `openspec status --change "<name>" --json` and `openspec instructions <artifact> --change "<name>" --json`
- `continue` -> inspect `openspec status --change "<name>" --json`, find the first ready artifact, and create only that next artifact
- `apply` -> use `openspec instructions apply --change "<name>" --json`, read the context files it returns, implement pending tasks, and update task checkboxes
- `plan-issues` -> read proposal, design, and `references/issue-mode-config.md`, then create or refresh `tasks.md`, `issues/INDEX.md`, and `ISSUE-*.md` files with explicit scope boundaries
- `dispatch-issue` -> read the selected `ISSUE-*.md`, create or reuse the issue worktree when appropriate, render the team dispatch by default and the single-issue dispatch only when explicitly narrowed, and prefer the next pending issue from reconcile when the user did not specify one
- `execute-issue` -> read `references/issue-mode-contract.md` plus repo defaults, implement only the assigned issue, write `issues/ISSUE-*.progress.json` and `runs/RUN-*.json`, and do not update `tasks.md`
- `reconcile` -> read `references/issue-mode-contract.md`, inspect `openspec/changes/<name>/issues/ISSUE-*.md`, `openspec/changes/<name>/issues/*.progress.json`, and `openspec/changes/<name>/runs/*.json`, update coordinator-owned checklists if needed, then choose the next OpenSpec action
- `verify` -> compare tasks, specs, design, and implementation using `openspec status`, change artifacts, and code evidence
- `sync-specs` -> merge delta specs from `openspec/changes/<name>/specs/` into `openspec/specs/`
- `archive` -> prefer `openspec archive "<name>"`; if readiness is unclear, verify first

## IM-Friendly Output Style

- Prefer natural confirmations like “我先帮你把 proposal / design 补齐，先过设计评审，再进入任务拆分或实现” instead of telling the user to type a command.
- Mention raw commands only if the user explicitly asks what happened underneath.
- When the route is inferred, say it in one short line.

## Examples

Read `references/router/examples.md`.
