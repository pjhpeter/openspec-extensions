---
name: openspec-chat-router
description: Route natural-language chat or IM requests into the correct OpenSpec workflow step without requiring slash commands. Use when the user wants to drive the OpenSpec change workflow in plain language, such as “进入openspec模式”, “进入 openspec 模式”, “开启openspec模式”, “给我 openspec 话术模板”, “列出当前 change 列表”, “起一个变更”, “继续当前 change”, “把文档补齐后开始做”, “检查能不能归档”, “同步 delta spec”, “按 issue 模式继续”, “拆成 issue”, “给我 ISSUE-001 的 worker 模板”, “执行 ISSUE-001”, “同步 worker 进度”, “收敛 issue 状态”, “根据 worker 结果继续推进”, “开启 coordinator heartbeat”, “自动检查 worker 并通知我”, “启动 heartbeat”, “看看 heartbeat 状态”, “停止 heartbeat”, or similar requests about proposal/design/tasks/spec/archive work.
---

# OpenSpec Chat Router

Use this skill as a natural-language entrypoint for OpenSpec inside this project.
The user should be able to speak normally in chat or IM instead of typing `/opsx:*`.

## Local Companion Skills

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

Do not rely on hardcoded absolute filesystem paths for these resources.

## Core Rules

- Treat slash commands as internal equivalents, not as a requirement for the user.
- Do not stop at explaining which OpenSpec action matches. Execute the mapped workflow unless blocked.
- Keep the user-facing response natural and brief: first state the action you are taking, then proceed.
- If the user explicitly names a stage or command, that overrides heuristic routing.
- If the user asks to enter OpenSpec mode, print the OpenSpec mode cheat sheet instead of running a workflow stage.
- For large or complex work, prefer issue-based multi-session execution rather than keeping one long-running session alive.
- In issue-based execution, one new session should handle one issue only.
- In multi-session work on the same change, the coordinator session owns `tasks.md`, final progress, `verify`, and `archive` unless the user explicitly chooses a different owner.
- In issue-based execution, workers must write issue-local progress artifacts and run artifacts. They must not directly update `tasks.md`.
- Before a coordinator continues a change that already has issue artifacts, reconcile worker state from disk first instead of trusting chat memory.
- When present, use `openspec/issue-mode.json` as the repo-level default config for worktree paths, validation, and monitoring.
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
| They want to generate the next worker prompt, create the worker worktree, or dispatch one issue | `dispatch-issue` |
| They want one worker session to execute a single issue with explicit scope boundaries | `execute-issue` |
| They want to observe a worker process, inspect whether it is still alive, or recover what it is doing from persistent-host/process/session files/worktree state | `monitor-worker` |
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
- “给我 ISSUE-001 的 worker 模板 / 派发下一个 issue / 给 ISSUE-001 创建 worker worktree” -> `dispatch-issue`
- “本会话只处理 ISSUE-001 / 执行这个 issue / worker 继续做这个 issue” -> `execute-issue`
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
2. Split implementation into issue-sized units with clear boundaries.
3. Open one new session per issue.
4. Let the coordinator session maintain the global checklist and final verification.

Issue sizing guidance:

- One issue should ideally touch one bounded slice of the codebase.
- Avoid mixing UI, data model, Electron, i18n, and canvas runtime work in the same issue unless the change is tiny.
- If an issue needs a long explanation or many unrelated files, split it again.

Same-change multi-session rules:

- Coordinator session:
  - owns `tasks.md`
  - owns final progress accounting
  - owns `verify` and `archive`
  - reads `issues/*.progress.json` and `runs/*.json` before deciding the next step
  - is the only session allowed to update change-level checklists after reconciling worker state
  - uses worker monitoring only as a fallback when progress artifacts are stale, missing, or suspicious
- Worker session:
  - only handles one assigned issue
  - only edits its allowed scope
  - writes `openspec/changes/<change>/issues/ISSUE-*.progress.json`
  - writes `openspec/changes/<change>/runs/RUN-*.json`
  - reports back with issue id, changed files, validation, and whether coordinator action is needed
- Avoid having multiple sessions update the same checkbox list or spec file concurrently.
- Read `references/issue-mode-contract.md` whenever you are setting up or reconciling issue-based work.

## Change Selection

- If the user gives a change name, use it.
- If there is one active change, or recent context makes the target obvious, infer it and say so briefly.
- Otherwise, inspect available changes first with `openspec list --json`.
- In Codex or IM environments without a structured question tool, ask one short question only when multiple reasonable change candidates remain.

## Execution Strategy

### Special path: `mode`

If the user asks to enter OpenSpec mode, print a compact cheat sheet and stop unless they immediately include another concrete OpenSpec request.

Use a format like this:

```text
已进入 OpenSpec 模式。

你可以直接这样说：
- 帮我起一个变更，把文档一次性补齐
- 继续刚才那个 change
- 开始实现当前变更
- 检查一下当前变更能不能归档

对应命令：
| 话术模板 | 等价命令 | 含义 |
| 帮我梳理一下这个需求 | /opsx:explore | 先进入探索/澄清 |
| 帮我起一个变更，把文档补齐 | /opsx:propose | 小任务一键生成 proposal/design/tasks |
| 先建个 change，我想先看模板 | /opsx:new | 只创建 change 并展示第一步模板 |
| 把当前 change 的文档补齐到可以开始做 | /opsx:ff | 一次性补到可实现状态 |
| 继续刚才那个 change | /opsx:continue | 创建下一个 artifact |
| 开始实现当前变更 | /opsx:apply | 按 tasks 开始实现 |
| 检查一下当前变更能不能归档 | /opsx:verify | 做归档前校验 |
| 把这个 change 的 delta spec 同步到主 spec | /opsx:sync-specs | 同步主 spec |
| 这个变更做完了，帮我归档 | /opsx:archive | 收尾归档 |
```

Rules for `mode` output:

- Print the cheat sheet in Chinese unless the user asked for English.
- Include both the natural-language template and the equivalent slash command.
- Prefer the slash command form in the table, even if the runtime later falls back to raw `openspec` CLI.
- If the user asks “进入 openspec 模式并开始做 X”, print the cheat sheet first, then continue routing `X`.

### Special path: `issue-mode`

If the user asks for issue-based multi-session execution, print the issue-mode template and stop unless they already included a concrete change or issue request.

Use a format like this:

```text
已进入 OpenSpec Issue 模式。

推荐方式：
1. 主会话先补齐 proposal / design / tasks
2. 把复杂实现拆成多个 issue
3. 一个 issue 开一个新会话
4. worker 只写 issue-local progress 和 run 工件
5. 主会话用 reconcile 收敛状态，再统一维护 tasks.md、verify、archive

主会话话术模板：
- 继续 OpenSpec change `<change-name>`，先把文档补齐到可实现状态
- 把 `<change-name>` 拆成可并行的 issue，并给出每个 issue 的边界和验收标准
- 为 `<change-name>` 生成 `issues/INDEX.md` 和每个 issue 文档
- 为 `<issue-id>` 生成下一轮 worker dispatch 模板
- 收敛 `<change-name>` 当前所有 worker 的 issue 状态，并决定下一步
- 现在验证 `<change-name>` 是否可以归档

Worker 新会话模板：
继续 OpenSpec change `<change-name>`，执行单个 issue。

本会话只处理一个 issue：
- Issue: `<issue-id or summary>`
- Allowed scope:
  - `<path>`
- Out of scope:
  - `<path or concern>`
- Done when:
  - `<acceptance item>`

开始后先写：
- `openspec/changes/<change-name>/issues/<issue-id>.progress.json`
- `openspec/changes/<change-name>/runs/RUN-<timestamp>-<issue-id>.json`

完成后更新同一组工件，再按下面格式回报：
- Issue: `<issue-id>`
- Files: `<paths>`
- Validation: `<commands/result>`
- Progress Artifact: `openspec/changes/<change-name>/issues/<issue-id>.progress.json`
- Run Artifact: `openspec/changes/<change-name>/runs/RUN-<timestamp>-<issue-id>.json`
- Need Coordinator Update: `yes/no`
```

Rules for `issue-mode` output:

- Tell the user not to keep multiple issues in one long-running session.
- Default the coordinator to the main session.
- If the user says “按 issue 模式继续 `<change-name>`”, print the template first and then continue with the named change.
- If the task artifacts are not ready yet, route to `new`, `propose`, or `ff` before encouraging worker sessions.
- If the user is setting up issue-mode for the first time, remind them that workers should not touch `tasks.md`.

### Special path: `execute-issue`

If the user clearly scopes one worker session to one issue, prefer `openspec-execute-issue`.

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

### Special path: `reconcile`

If the user asks to sync worker outputs, collect issue progress, or continue a complex change after workers have written status files, prefer `openspec-reconcile-change`.

Reconcile is the default first step when:

- `issues/*.progress.json` already exists for the change
- the user says “继续当前 change” after issue-mode work
- the user asks whether the coordinator can continue automatically

### Special path: `heartbeat`

If the user asks for proactive polling, heartbeat monitoring,主动通知, or automatic dispatch of obvious next steps, use the bundled helper:

```bash
python3 .codex/skills/openspec-shared/scripts/coordinator_heartbeat.py \
  --repo-root . \
  --change "<change-name>"
```

Use repo defaults from `openspec/issue-mode.json` when present.
Override `--notify-topic`, `--interval-seconds`, `--stale-seconds`, or `--auto-dispatch-next` only when the user asked for different behavior.

### Special path: `heartbeat-start`

If the user asks to start a persistent heartbeat session, prefer the target-side wrapper:

```bash
python3 scripts/openspec_coordinator_heartbeat_start.py \
  --change "<change-name>"
```

Add `--auto-dispatch-next` only when the user explicitly wants automatic dispatch of the next mechanical step.

### Special path: `heartbeat-status`

If the user asks whether heartbeat is still running or wants the current screen/session state, run:

```bash
python3 scripts/openspec_coordinator_heartbeat_status.py \
  --change "<change-name>"
```

### Special path: `heartbeat-stop`

If the user asks to stop the persistent heartbeat session, run:

```bash
python3 scripts/openspec_coordinator_heartbeat_stop.py \
  --change "<change-name>"
```

### Special path: `monitor-worker`

If the user asks whether a worker is still alive, wants to inspect its current stage, or needs to recover progress from a persistent host, OS processes, Codex session files, or worktree state, prefer `openspec-monitor-worker`.

Use monitoring as a fallback layer.
Do not replace artifact-based reconcile with process inspection when `issues/*.progress.json` and `runs/*.json` are already current.

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
- `execute-issue` -> read `references/issue-mode-contract.md` plus repo defaults, implement only the assigned issue, write `issues/ISSUE-*.progress.json` and `runs/RUN-*.json`, and do not update `tasks.md`
- `monitor-worker` -> inspect the configured persistent host, OS processes, Codex session jsonl files, and `git status` for the target worktree; treat the result as observability data, not the workflow source of truth
- `reconcile` -> read `references/issue-mode-contract.md`, inspect `openspec/changes/<name>/issues/ISSUE-*.md`, `openspec/changes/<name>/issues/*.progress.json`, and `openspec/changes/<name>/runs/*.json`, update coordinator-owned checklists if needed, then choose the next OpenSpec action
- `verify` -> compare tasks, specs, design, and implementation using `openspec status`, change artifacts, and code evidence
- `sync-specs` -> merge delta specs from `openspec/changes/<name>/specs/` into `openspec/specs/`
- `archive` -> prefer `openspec archive "<name>"`; if readiness is unclear, verify first

## IM-Friendly Output Style

- Prefer natural confirmations like “我先帮你把 proposal / design / tasks 补齐，然后再进入实现” instead of telling the user to type a command.
- Mention raw commands only if the user explicitly asks what happened underneath.
- When the route is inferred, say it in one short line, for example: “按你的描述，我先走 OpenSpec 的 `apply` 阶段，继续实现当前 change。”

## Examples

- “进入 openspec 模式。” -> print the cheat sheet
- “进入 openspec 模式，然后帮我起一个变更。” -> print the cheat sheet, then route to `propose`
- “这个任务很复杂，按 issue 模式继续。” -> print the issue-mode template
- “按 issue 模式继续 `add-infinite-canvas-node-naming`。” -> print the issue-mode template, then continue with that change
- “把这个 change 拆成几个可并行 issue。” -> `plan-issues`
- “给我 ISSUE-001 的 worker 派发模板。” -> `dispatch-issue`
- “给 ISSUE-001 创建 worker worktree。” -> `dispatch-issue`
- “这个 worker 会话只做 ISSUE-002。” -> `execute-issue`
- “看看 worker1 现在跑到哪一步了。” -> `monitor-worker`
- “这个 worker 还活着吗？” -> `monitor-worker`
- “同步一下当前 change 的 worker 进度。” -> `reconcile`
- “根据 worker 结果继续推进这个 change。” -> `reconcile`
- “这个需求我还没想清楚，你先帮我梳理一下。” -> `explore`
- “帮我起一个登录重构的变更，把文档一次性补齐。” -> `propose`
- “先建个 change，我想先看第一步文档模板。” -> `new`
- “把当前 change 的文档补齐到可以开始做。” -> `ff`
- “继续刚才那个 change。” -> `continue`
- “现在开始实现这个变更。” -> `apply`
- “检查一下当前变更能不能归档。” -> `verify`
- “把这个 change 的 delta spec 同步到主 spec。” -> `sync-specs`
- “这个变更做完了，帮我归档。” -> `archive`
