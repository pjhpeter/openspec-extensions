---
name: openspec-chat-router
description: Route natural-language chat or IM requests into the correct OpenSpec workflow step without requiring slash commands. Use when the user wants to drive the OpenSpec change workflow in plain language, such as “进入openspec模式”, “进入 openspec 模式”, “开启openspec模式”, “给我 openspec 话术模板”, “列出当前 change 列表”, “起一个变更”, “继续当前 change”, “把文档补齐后开始做”, “检查能不能归档”, “同步 delta spec”, “按 issue 模式继续”, “拆成 issue”, “给我 ISSUE-001 的 worker 模板”, “直接开 subagent 做 ISSUE-001”, “执行 ISSUE-001”, “同步 worker 进度”, “收敛 issue 状态”, “根据 worker 结果继续推进”, or, when they explicitly want background automation, “开启 coordinator heartbeat”, “自动检查 worker 并通知我”, “启动 heartbeat”, “看看 heartbeat 状态”, “停止 heartbeat”.
---

# OpenSpec Chat Router

Use this skill as a natural-language entrypoint for OpenSpec inside this project.
The user should be able to speak normally in chat or IM instead of typing `/opsx:*`.

Read the relevant local companion skill or router reference first when the route becomes concrete.

## Companion Resources

When this router maps intent to a concrete OpenSpec action, prefer the project-local companion skill first.
These companion skills live next to this router and should be treated as relative project resources:

- `../openspec-explore/SKILL.md`
- `../openspec-propose/SKILL.md`
- `../openspec-new-change/SKILL.md`
- `../openspec-ff-change/SKILL.md`
- `../openspec-continue-change/SKILL.md`
- `../openspec-apply-change/SKILL.md`
- `../openspec-plan-issues/SKILL.md`
- `../openspec-dispatch-issue/SKILL.md`
- `../openspec-execute-issue/SKILL.md`
- `../openspec-monitor-worker/SKILL.md`
- `../openspec-reconcile-change/SKILL.md`
- `../openspec-verify-change/SKILL.md`
- `../openspec-sync-specs/SKILL.md`
- `../openspec-archive-change/SKILL.md`
- `references/issue-mode-contract.md`
- `references/issue-mode-config.md`
- `references/issue-mode-rra.md`
- `references/router/background-automation.md`
- `references/router/coordinator-playbook.md`
- `references/router/examples.md`
- `references/router/mode-cheatsheet.md`
- `references/router/issue-mode-template.md`

Do not rely on hardcoded absolute filesystem paths for these resources.

## Core Rules

- Treat slash commands as internal equivalents, not as a requirement for the user.
- Do not stop at explaining which OpenSpec action matches. Execute the mapped workflow unless blocked.
- Keep the user-facing response natural and brief: first state the action you are taking, then proceed.
- If the user explicitly names a stage or command, that overrides heuristic routing.
- If the user asks to enter OpenSpec mode, print the OpenSpec mode cheat sheet instead of running a workflow stage.
- For large or complex work, prefer issue-based multi-session execution plus a change-level review/repair/re-review/acceptance loop rather than keeping one long-running session alive.
- In issue-based execution, one worker context should handle one issue only.
- In runtimes that support subagents or delegation, prefer the coordinator spawning one worker subagent per issue instead of asking the user to open a separate worker chat by default.
- In issue-based execution, the default flow is: coordinator creates or reuses the issue worktree, dispatches one worker subagent or one external worker session into that worktree, waits for worker completion, then reviews the issue from the main session before accepting it.
- In multi-session work on the same change, the coordinator session owns `tasks.md`, final progress, `verify`, and `archive` unless the user explicitly chooses a different owner.
- In multi-session work on the same change, the coordinator session also owns the change-level normalized backlog, round target, and acceptance verdict.
- In issue-based execution, the coordinator session also owns review of completed issues, merging accepted worker worktrees back to the coordinator branch, and creating the git commit after merge.
- In issue-based execution, workers must write issue-local progress artifacts and run artifacts. They must not directly update `tasks.md`.
- In issue-based execution, workers must not merge their own worktree back or create the final git commit for the issue unless the user explicitly overrides that rule.
- Before a coordinator continues a change that already has issue artifacts, reconcile worker state from disk first and read change-level control artifacts if present instead of trusting chat memory.
- When present, use `openspec/issue-mode.json` as the repo-level default config for worktree paths, validation, and monitoring.
- Treat heartbeat, persistent host monitoring, and detached worker launch as explicit fallback tools for background or off-session automation, not as the default issue execution path.
- In normal issue-mode guidance, do not proactively steer the user toward detached worker launch or heartbeat unless they asked for background automation.
- If the intent is still ambiguous after doing all non-blocked work, ask exactly one short targeted question.

## Intent Routing

Map the user's request to the closest OpenSpec action.

| Natural-language intent | Route |
| --- | --- |
| The idea is still fuzzy, they want to discuss, compare, or think first | `explore` |
| They want to quickly start a small change and generate proposal/design/tasks in one go | `propose` |
| They want to create a new change scaffold and inspect the first artifact before continuing | `new` |
| They want to fill all ready artifacts until implementation can start | `ff` |
| They want to resume a change or create the next artifact | `continue` |
| They want to implement, code, land, or continue coding from the change tasks | `apply` |
| They want to split a complex change into issue-sized work packages or create issue docs | `plan-issues` |
| They want to generate the next worker prompt, create the worker worktree, prepare a subagent handoff, or dispatch one issue | `dispatch-issue` |
| They want one worker subagent or one worker session to execute a single issue with explicit scope boundaries | `execute-issue` |
| They want to observe a detached worker process, inspect whether it is still alive, or recover what it is doing from persistent-host/process/session files/worktree state | `monitor-worker` |
| They want to sync worker outputs, collect issue progress, or decide the next coordinator step | `reconcile` |
| They want the coordinator to poll worker state, notify proactively, or auto-dispatch mechanical next steps | `heartbeat` |
| They want to start the persistent heartbeat screen session | `heartbeat-start` |
| They want to inspect heartbeat screen/session state | `heartbeat-status` |
| They want to stop the persistent heartbeat screen session | `heartbeat-stop` |
| They want to verify completeness, readiness, or acceptance before closing the change | `verify` |
| They want to merge delta specs into the main specs | `sync-specs` |
| They want to finish, archive, close out, or收尾 the change | `archive` |
| They want to enter OpenSpec mode, see example phrasing, or view the command mapping | `mode` |
| They want to execute a complex change by issue, split work across new sessions, or see the multi-session template | `issue-mode` |
| They want to know which changes exist or inspect current status | `list` or `status` |

## Default Heuristics

Use these defaults when the user does not name a stage explicitly:

- “没想清楚 / 先聊聊 / 先梳理一下” -> `explore`
- Small task -> `propose` -> `apply` -> `archive`
- Large task -> `new` -> `ff` -> `apply` -> `verify` -> `archive`
- “继续刚才那个 / 继续这个 change / 下一个文档” -> `continue`
- “开始做 / 开始实现 / 直接落地” -> `apply`
- “拆成 issue / 给出 issue 边界 / 生成 issue 文档” -> `plan-issues`
- “给我 ISSUE-001 的 worker 模板 / 派发下一个 issue / 给 ISSUE-001 创建 worker worktree / 直接开 subagent 做 ISSUE-001” -> `dispatch-issue`
- “本会话只处理 ISSUE-001 / 执行这个 issue / worker 继续做这个 issue / subagent 只做 ISSUE-001” -> `execute-issue`
- “看看 worker1 还活着吗 / 监控 worker / worker 做到哪一步了” -> `monitor-worker`
- “同步 worker 进度 / 收敛 issue 状态 / 根据 worker 结果继续推进” -> `reconcile`
- “开启 heartbeat / 自动检查 worker / 有结果就通知我 / 自动派发下一个 issue” -> `heartbeat`
- “启动 heartbeat / 常驻运行 heartbeat / 开个 screen 挂着 heartbeat” -> `heartbeat-start`
- “heartbeat 还在跑吗 / 看看 heartbeat 状态 / heartbeat 的 screen 在吗” -> `heartbeat-status`
- “停止 heartbeat / 关掉 heartbeat / 把 heartbeat screen 停掉” -> `heartbeat-stop`
- “看看做完没有 / 能不能验收 / 能不能归档” -> `verify`
- “进入 openspec 模式 / 给我 openspec 话术模板 / 把命令表打出来” -> `mode`
- “这个任务很复杂 / 按 issue 模式继续 / 给我多会话模板 / 给我 worker 会话模板” -> `issue-mode`

## Complex Change Rules

When the task is complex, do not rely on one giant session.

Preferred flow:

1. Use the main session to get the change to implementation-ready state.
2. Run a change-level readiness review and keep a normalized backlog for the current round.
3. Split implementation into issue-sized units with clear boundaries.
4. Review the issue plan before dispatching issue work.
5. For each approved issue, create or reuse the worker git worktree before handoff.
6. If the runtime supports delegation, spawn one worker subagent per issue and keep it inside that issue worktree only.
7. If detached/background execution is required, fall back to one external worker session per issue.
8. After the worker reports `review_required`, let the coordinator review the worktree, update the change-level backlog, merge accepted changes back to the coordinator branch, and create the commit.
9. Let the coordinator session maintain the global checklist, change-level acceptance, and final verification.

Issue sizing guidance:

- One issue should ideally touch one bounded slice of the codebase.
- Avoid mixing UI, data model, Electron, i18n, and canvas runtime work in the same issue unless the change is tiny.
- If an issue needs a long explanation or many unrelated files, split it again.

Same-change multi-session rules:

- Coordinator session:
  - owns `tasks.md`
  - owns change-level backlog and round reports
  - owns final progress accounting
  - owns review of completed issues
  - owns merging accepted worker worktrees back to the coordinator branch
  - owns the final git commit after merge
  - owns `verify` and `archive`
  - reads `issues/*.progress.json` and `runs/*.json` before deciding the next step
  - reads `control/BACKLOG.md` and the latest `control/ROUND-*.md` when present
  - is the only session allowed to update change-level checklists after reconciling worker state
  - uses worker monitoring only as a fallback when progress artifacts are stale, missing, or suspicious
- Worker context:
  - only handles one assigned issue
  - works only inside the assigned issue worktree
  - only edits its allowed scope
  - writes `openspec/changes/<change>/issues/ISSUE-*.progress.json`
  - writes `openspec/changes/<change>/runs/RUN-*.json`
  - does not merge its worktree back or create the final git commit
  - reports new out-of-scope findings as blockers or backlog candidates instead of widening scope silently
  - reports back with issue id, changed files, validation, and whether coordinator action is needed
- Avoid having multiple worker contexts update the same checkbox list or spec file concurrently.
- Read `references/issue-mode-contract.md` whenever you are setting up or reconciling issue-based work.

## Change Selection

- If the user gives a change name, use it.
- If there is one active change, or recent context makes the target obvious, infer it and say so briefly.
- Otherwise, inspect available changes first with `openspec list --json`.
- In Codex or IM environments without a structured question tool, ask one short question only when multiple reasonable change candidates remain.

## Execution Strategy

### Special path: `mode`

If the user asks to enter OpenSpec mode, print a compact cheat sheet and stop unless they immediately include another concrete OpenSpec request.
Read `references/router/mode-cheatsheet.md`.

Rules for `mode` output:

- Print the cheat sheet in Chinese unless the user asked for English.
- Include both the natural-language template and the equivalent slash command.
- Prefer the slash command form in the table, even if the runtime later falls back to raw `openspec` CLI.
- If the user asks “进入 openspec 模式并开始做 X”, print the cheat sheet first, then continue routing `X`.

### Special path: `issue-mode`

If the user asks for issue-based multi-session execution, print the issue-mode template and stop unless they already included a concrete change or issue request.
Read `references/router/issue-mode-template.md`.

Rules for `issue-mode` output:

- Tell the user not to keep multiple issues in one long-running session.
- Default the coordinator to the main session.
- Remind the user that the coordinator should create or reuse the issue worktree before handing the issue to a worker.
- Remind the user that subagent-first is the default when delegation is available; detached workers and heartbeat are fallback paths.
- If the user says “按 issue 模式继续 `<change-name>`”, print the template first and then continue with the named change.
- If the task artifacts are not ready yet, route to `new`, `propose`, or `ff` before encouraging worker sessions.
- If the user is setting up issue-mode for the first time, remind them that workers should not touch `tasks.md`.
- Remind the user that workers should not merge or commit; the coordinator reviews, merges, and commits after accepting the issue.
- Remind the user that the coordinator should keep change-level backlog and acceptance decisions on disk for complex changes.
- Do not mention heartbeat in the default issue-mode template unless the user explicitly asks for background or detached execution.

### Special path: `execute-issue`

If the user clearly scopes one worker context to one issue, prefer `openspec-execute-issue`.

Use it when the prompt already includes:

- `Issue: ISSUE-001`
- `Allowed scope`
- `Out of scope`
- `Done when`

If any of those are missing, do all non-blocked work first and then ask one short question only if the missing boundary is risky.

### Special path: `plan-issues`

If the user asks to split a complex change into issues, define issue boundaries, or create issue docs for workers, prefer `openspec-plan-issues`.

Use it to create:

- `openspec/changes/<change>/issues/INDEX.md`
- `openspec/changes/<change>/issues/ISSUE-001.md`
- additional `ISSUE-*.md` files as needed

### Special path: `dispatch-issue`

If the user asks for the next worker template, a dispatch prompt, or a copy-paste message for one issue, prefer `openspec-dispatch-issue`.

Dispatch should be generated from the issue doc on disk, not improvised from chat memory.
If the repo uses worker git worktrees, this path can also create or reuse the issue worktree before handoff.
When the runtime supports delegation and the user wants the coordinator to proceed immediately, use the generated dispatch as the input for one spawned worker subagent instead of requiring a separate worker chat by default.

### Special path: `reconcile`

If the user asks to sync worker outputs, collect issue progress, or continue a complex change after workers have written status files, prefer `openspec-reconcile-change`.

Reconcile is the default first step when:

- `issues/*.progress.json` already exists for the change
- the user says “继续当前 change” after issue-mode work
- the user asks whether the coordinator can continue automatically

### Background automation paths

For `heartbeat`, `heartbeat-start`, `heartbeat-status`, `heartbeat-stop`, and `monitor-worker`, read `references/router/background-automation.md`.

Summary rule:

- use these paths only when the user explicitly wants detached/background automation or recovery of a detached worker
- do not route here just because issue-mode exists
- prefer normal reconcile, coordinator review, and subagent dispatch inside the active session whenever those are sufficient

### Preferred issue execution path in runtimes with delegation

Read `references/router/coordinator-playbook.md`.

Summary rule:

- `dispatch-issue` prepares the issue worktree and source-of-truth dispatch
- one subagent handles one issue
- reconcile, review, merge, change-level acceptance, verify, and archive stay in the coordinator session
- fall back to detached/background automation only when the user explicitly asks for it

### Preferred path: route to the dedicated project-local OpenSpec skill

If the corresponding companion skill exists, follow it:

- `explore` -> `openspec-explore`
- `propose` -> `openspec-propose`
- `new` -> `openspec-new-change`
- `ff` -> `openspec-ff-change`
- `continue` -> `openspec-continue-change`
- `apply` -> `openspec-apply-change`
- `plan-issues` -> `openspec-plan-issues`
- `dispatch-issue` -> `openspec-dispatch-issue`
- `execute-issue` -> `openspec-execute-issue`
- `monitor-worker` -> `openspec-monitor-worker`
- `reconcile` -> `openspec-reconcile-change`
- `verify` -> `openspec-verify-change`
- `sync-specs` -> `openspec-sync-specs`
- `archive` -> `openspec-archive-change`

Do not ask the user to rephrase their request as a slash command if the intent is already clear.

### Fallback path: use OpenSpec CLI directly

If the dedicated skill is unavailable, use the closest OpenSpec CLI flow and continue working:

- `list` -> `openspec list --json`
- `status` -> `openspec status --change "<name>" --json`
- `new` -> `openspec new change "<name>"`, then `openspec status --change "<name>"`
- `propose` or `ff` -> create or select the change, then use `openspec status --change "<name>" --json` and `openspec instructions <artifact> --change "<name>" --json` to generate ready artifacts until the change is implementation-ready
- `continue` -> inspect `openspec status --change "<name>" --json`, find the first ready artifact, and create only that next artifact
- `apply` -> use `openspec instructions apply --change "<name>" --json`, read the context files it returns, implement pending tasks, and update task checkboxes
- `plan-issues` -> read proposal, design, tasks, and `references/issue-mode-config.md`, then create `issues/INDEX.md` plus `ISSUE-*.md` files with explicit scope boundaries
- `dispatch-issue` -> read the selected `ISSUE-*.md`, create or reuse the worker git worktree when appropriate, render a worker dispatch prompt/file, and prefer the next pending issue from reconcile when the user did not specify one
- when delegation tools are available and the user wants the coordinator to proceed immediately, use that dispatch to launch exactly one worker subagent for the issue
- `execute-issue` -> read `references/issue-mode-contract.md` plus repo defaults, implement only the assigned issue, write `issues/ISSUE-*.progress.json` and `runs/RUN-*.json`, and do not update `tasks.md`
- `monitor-worker` -> inspect the configured persistent host, OS processes, Codex session jsonl files, and `git status` for the target worktree; treat the result as observability data for detached/background workers, not the workflow source of truth
- `reconcile` -> read `references/issue-mode-contract.md`, inspect `openspec/changes/<name>/issues/ISSUE-*.md`, `openspec/changes/<name>/issues/*.progress.json`, and `openspec/changes/<name>/runs/*.json`, update coordinator-owned checklists if needed, then choose the next OpenSpec action
- `verify` -> compare tasks, specs, design, and implementation using `openspec status`, change artifacts, and code evidence
- `sync-specs` -> merge delta specs from `openspec/changes/<name>/specs/` into `openspec/specs/`
- `archive` -> prefer `openspec archive "<name>"`; if readiness is unclear, verify first

## IM-Friendly Output Style

- Prefer natural confirmations like “我先帮你把 proposal / design / tasks 补齐，然后再进入实现” instead of telling the user to type a command.
- Mention raw commands only if the user explicitly asks what happened underneath.
- When the route is inferred, say it in one short line, for example: “按你的描述，我先走 OpenSpec 的 `apply` 阶段，继续实现当前 change。”

## Examples

Read `references/router/examples.md`.
