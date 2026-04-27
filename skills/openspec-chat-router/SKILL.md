---
name: openspec-chat-router
description: Route natural-language chat or IM requests into the correct OpenSpec workflow step without requiring slash commands. Use when the user wants to drive the OpenSpec change workflow in plain language, such as “进入openspec模式”, “进入 openspec 模式”, “给我 openspec 话术模板”, “列出当前 change 列表”, “起一个变更”, “继续当前 change”, “把文档补齐后开始做”, “检查能不能归档”, “同步 delta spec”, “按 issue 模式继续”, “拆成 issue”, “给我 ISSUE-001 的派发模板”, “直接开 subagent 做 ISSUE-001”, “用 subagent team 推进 ISSUE-001”, “执行 ISSUE-001”, “同步 issue 进度”, or “根据 issue 结果继续推进”.
---

# OpenSpec Chat Router

Use this skill as the natural-language entrypoint for OpenSpec inside this project.
The user should be able to speak normally in chat or IM instead of typing `/opsx:*`.

## Session Startup Update Check

- 在当前主会话里首次触发任一 `openspec-extensions` skill 时，先做一次非阻塞版本检查，再继续正常路由。
- 如果仓库里有 `openspec/openspec-extensions.json`，先读取其中的 `installed_version` 作为仓库记录版本。
- 版本检查优先比较 npm 最新版本与仓库记录版本；如果仓库元数据缺失，再退回比较当前已安装 CLI 版本。检查失败时直接跳过，不要阻塞当前流程。
- 如果发现 npm 有更新版本，只打印一条高亮提醒，然后继续后续逻辑，不要要求用户先升级，也不要中断当前执行。
- 如果当前走的是 `mode` 路径，把这条高亮提醒追加在 cheat sheet 主体全部内容之后，作为最后一段输出；不要把提醒放在最上面。
- 高亮提醒统一使用这句：
  - `【更新提醒】检测到 openspec-extensions 有新版本。可先退出到命令行执行 \`npm update -g openspec-extensions\` 更新 openspec-extensions，再执行 \`openspec-ex install --target-repo /path/to/your/project --force --force-config\` 刷新当前仓库插件；当前流程继续，不受这条提醒影响。`
- spawned seat / worker 子会话不要重复这条提醒；这条提醒只属于当前用户可见的主会话或 coordinator 会话。

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
- `openspec/openspec-extensions.json` if the repo has one
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
- When the user does not explicitly choose simple vs complex flow, run a lightweight complexity triage first and make the default route explainable in one short sentence.
- After complexity triage selects the complex flow, immediately restate a route decision before doing more work, for example: `路由决议：复杂流。当前只允许补 proposal/design 并推进 spec_readiness；禁止开始实现。`
- Once the target change is known, record that triage result to `openspec/changes/<change>/control/ROUTE-DECISION.json` so later sessions can inspect the chosen route instead of relying on chat memory only.
- If the user explicitly says "你自己判断复杂度，复杂时自动启用 subagent-team" or an equivalent instruction, treat that as permission for the main coordinator session to use delegation when the triage selects the complex flow.
- If the user asks to enter OpenSpec mode, print the OpenSpec mode cheat sheet instead of running a workflow stage.
- For large or complex work, prefer issue-based execution plus a change-level review/repair/re-review/acceptance loop rather than one long-running session.
- If the current session already carries an explicit spawned-seat handoff, do not route again through chat-router heuristics; that seat contract overrides inherited coordinator defaults.
- In issue-based execution, one issue-scoped execution context handles one issue only.
- In issue-mode, default the coordinator entry path to `openspec-subagent-team`.
- In runtimes that support subagents or delegation, prefer the coordinator continuing through the approved issue round with `subagent-team`.
- If the target change already has issue-mode state on disk such as `issues/*.progress.json`, `issues/*.team.dispatch.md`, `runs/ISSUE-PLANNING.json`, or `control/ACTIVE-SEAT-DISPATCH.json`, treat that disk state as higher priority than generic implementation wording like “开始做 / 开始实现 / 直接落地”; reconcile first, then continue the subagent-team main path unless the user explicitly tells you to abandon issue-mode and go back to the simple flow.
- If the runtime does not support delegation at all, fall back to the main-session serial issue path: keep the coordinator in the current session, render the lifecycle / issue dispatch packets, execute one approved issue at a time locally, and keep progress/run artifacts on disk.
- Do not activate the main-session serial fallback just because the current issue looks manageable or because the main session could write code locally. Use that fallback only after explicit evidence that the current runtime cannot delegate, or that the required seats cannot be launched and recovered stably.
- The "runtime does not support delegation" fallback belongs only to the main coordinator session; spawned seat subagents must report seat-local results and stop instead of activating that fallback themselves.
- Use the single-issue `dispatch-issue` / `execute-issue` path only when the user explicitly wants one bounded issue-only subagent, or the current phase has already been narrowed to that one issue.
- The default issue-mode flow is: coordinator enters through `openspec-subagent-team`, creates or reuses the approved issue workspace as needed, drives the current round, then reviews accepted issue output from the main session before acceptance and commit.
- Selecting the complex flow is a routing decision, not implementation authorization. Until `runs/SPEC-READINESS.json` is current and passed, do not start implementation, do not run scaffolding or app-bootstrap commands, and do not launch code-writing execution seats.
- Even after spec-readiness passes, the first issue execution still waits for a current passed `runs/ISSUE-PLANNING.json` plus the coordinator-owned planning-doc commit. Do not dispatch implementation work before those artifacts exist.
- In multi-session work on the same change, the coordinator session owns `tasks.md`, change-level backlog, merge, commit, `verify`, and `archive`.
- Issue execution subagents must write issue-local progress and run artifacts. They must not directly update `tasks.md`, self-merge, or create the final git commit.
- Before a coordinator continues a change that already has issue artifacts, reconcile issue state from disk first and read change-level control artifacts if present instead of trusting chat memory.
- Use `openspec/issue-mode.json` only for active repo defaults: worktree location, validation commands, worktree creation mode, RRA gate mode, and subagent-team auto-accept switches.
- When delegation is used, explicitly launch the design-author subagent and any code-writing subagent with `reasoning_effort=high`; all other design/planning/check/review/closeout-only subagents should use `reasoning_effort=medium`.
- In subagent-team flow, treat gate-bearing design review / check / review seats as hard barrier participants, not sidecar helpers.
- `auto_accept_*` only skips human chat sign-off after those gate-bearing subagents have finished and their verdicts have been normalized.
- For long-running gate-bearing subagents, prefer blocking waits up to 1 hour instead of short polling.
- Do not launch gate-bearing review/check seats as `explorer`, and do not close them while their phase still depends on their verdicts.
- Before unattended gate-bearing batches, check `ulimit -n` when shell access is available; if it is below `16384`, pause and restart the tool session with a larger open-files limit before spawning checker/reviewer seats.
- If shell/process creation fails with `EMFILE`, `ENFILE`, or `Too many open files`, treat the current gate verdict as missing, recover or restart the tool session, clear stale running seats, and rerun the current gate from the active dispatch. Do not self-certify or skip the checker/reviewer gate.
- If the intent is still ambiguous after doing all non-blocked work, ask exactly one short targeted question.

## Complexity Triage

Use this triage only when the user did not already force a specific stage or mode.

Score the request from the requirement text plus current repo artifacts:

- `+1` if the change likely spans multiple modules, directories, or subsystems.
- `+1` if proposal/design work is still materially unknown and should be reviewed before coding.
- `+1` if the work likely needs issue splitting, round-based coordination, or more than one execution seat.
- `+1` if validation, review, or acceptance is likely multi-stage or expensive.
- `+1` if the change touches public specs, release flow, migrations, permissions, or other high-risk boundaries.
- `+1` if the user explicitly says the work is complex, long-running, or should be unattended across phases.

Route based on the total:

- `0-1` -> simple flow: prefer `propose` / `apply` / change-level `review` / `verify` / `archive`
- `2-3` -> borderline: prefer `new` or `ff`, then re-evaluate after proposal/design context is clearer; ask one short question only if the route is still materially ambiguous
- `4+` -> complex flow: prefer `issue-mode`, then default the coordinator entry to `subagent-team`

Guardrails:

- Treat complexity triage as a mandatory gate before implementation whenever the user did not explicitly force a stage; do not skip it just because the work feels locally doable.
- Existing issue artifacts on disk override a fresh simple-flow guess; reconcile first.
- Once issue-mode state exists on disk for the target change, keep that route sticky across later "start implementing" or "continue coding" messages unless the user explicitly asks to exit issue-mode.
- When a concrete change is already selected, persist the triage result to `control/ROUTE-DECISION.json` with the route, score, short summary, rationale bullets, recommended flow, and timestamp.
- A `2-3` borderline result is not implementation authorization; route to `new` or `ff` first, then re-evaluate after proposal/design becomes clearer.
- When the triage lands on the complex path, stop treating generic implementation wording as permission to code. First produce the route decision, then continue through proposal/design and the documented gates.
- When the triage lands on the complex path and delegation is available, `issue-mode -> subagent-team` is the default coordinator route. Do not keep going as a simple local `apply` path just because the task still looks manageable in one session.
- In the first user-facing execution update after selecting the complex path, explicitly state the route and the immediate restriction, for example: `路由决议：复杂流。我将按 subagent-team 协调推进；当前只允许补 proposal/design 并推进 spec_readiness，禁止开始实现。`
- A single-file or tightly bounded change should not be promoted to issue-mode without concrete evidence from the request or artifacts.
- If a simple-flow execution uncovers cross-module scope, repeated review loops, or clear issue boundaries, explicitly upgrade to the complex flow and state why.
- If the user already authorized "complex -> auto subagent-team", do not ask again before using `subagent-team` in the main coordinator session once the triage lands on the complex path.
- Before final completion, audit whether the selected route was actually followed. If execution drifted from the chosen route, disclose that deviation explicitly instead of silently summarizing the work as compliant.
- The route explanation should be short and concrete, for example: "先按简单流程走，因为范围集中且不需要 issue 拆分。" or "改为复杂流程，因为已经跨模块并且需要 design review + issue 拆分。"

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
| They want to generate the next issue handoff packet, create the issue workspace, or prepare a bounded subagent handoff for one issue | `dispatch-issue` |
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
- Default to `complexity triage` before choosing the simple or complex path when the user only describes the requirement.
- Small task after triage -> `propose` -> `apply` -> review current code -> automated test/validation + automated manual verification -> `verify` -> `archive`
- Large task after triage -> `new` -> `ff` -> `plan-issues` / `subagent-team` -> reconcile -> review current code -> automated test/validation + automated manual verification evidence -> `verify` -> `archive`
- “继续刚才那个 / 继续这个 change / 下一个文档” -> `continue`
- “开始做 / 开始实现 / 直接落地” -> `apply`, but only when the target change does not already have active issue-mode state on disk
- “拆成 issue / 给出 issue 边界 / 生成 issue 文档” -> `plan-issues`
- “给我 ISSUE-001 的派发模板 / 派发下一个 issue / 给 ISSUE-001 创建 issue workspace / 直接开 subagent 做 ISSUE-001” -> `dispatch-issue`
- “用 subagent team 推进 ISSUE-001 / 开发组检查组审查组一起推进” -> `subagent-team`
- “本会话只处理 ISSUE-001 / 执行这个 issue / subagent 只做 ISSUE-001” -> `execute-issue`
- “同步 issue 进度 / 收敛 issue 状态 / 根据 issue 结果继续推进” -> `reconcile`
- “看看做完没有 / 能不能验收 / 能不能归档” -> `verify`
- “进入 openspec 模式 / 给我 openspec 话术模板 / 把命令表打出来” -> `mode`
- “这个任务很复杂 / 按 issue 模式继续 / 给我多会话模板” -> `issue-mode`，随后默认进入 `subagent-team`
- “你自己判断复杂度 / 自己选简单还是复杂流程” -> run `complexity triage`, briefly explain the chosen route, then execute it
- “你自己判断复杂度，复杂时自动启用 subagent-team / 自动使用多 agent 编排” -> run `complexity triage`; if the result is complex and delegation is available, enter `issue-mode -> subagent-team` without asking again

## Complex Change Rules

Preferred flow:

1. Use the main session to get the change to proposal/design-ready state.
2. Run a change-level spec-readiness design review with a dedicated `1` design-author subagent plus `2` design-review subagents, and keep a normalized backlog for that gate.
3. Treat the route decision as a hard boundary: complex flow selected means issue-mode coordination is now authoritative, but implementation is still forbidden until spec-readiness passes.
4. Before `runs/SPEC-READINESS.json` is current and passed, do not start implementation, do not run project scaffolding or bootstrap commands, and do not spawn code-writing seats.
5. Only after design review passes, split implementation into coordinator-owned `tasks.md` plus issue-sized units with clear boundaries.
6. Before the first issue execution, require a current passed `runs/ISSUE-PLANNING.json` and the coordinator-owned planning-doc commit; do not let `subagent-team` wording or "start implementing" chat text skip those prerequisites.
7. Review the issue plan, then commit `proposal.md` / `design.md` / `tasks.md` / `issues/INDEX.md` / `ISSUE-*.md` as a coordinator-owned planning-doc commit before the first issue dispatch.
8. For each approved issue, create or reuse the issue workspace (`worker_worktree`) before handoff. The installed template defaults to one change-level `.worktree/<change>` reused across that change's serial issues.
9. If delegation is available, the main session remains coordinator-only during issue execution. Do not treat “complex flow”, “issue_execution”, or “continue coding” as permission for the coordinator to implement business code directly.
10. By default, render the subagent-team lifecycle packet and use it as the coordinator control packet for the current phase.
11. Use one issue-only execution subagent for one approved issue only when the user explicitly narrows execution to that one issue, or the current step is already a bounded single-issue handoff. Do not reuse that full worker contract for development/check/review seats inside an issue-team round.
11. In subagent-team `issue_execution`, development seats stop at implementation and progress checkpoint. If code changes invalidate prior validation, they only mark those validation entries back to `pending`; checker/reviewer and the coordinator own the later validation/review gate. Only after checker/reviewer finish and the coordinator records `runs/ISSUE-REVIEW-<issue>.json` should the issue move to `review_required`, after which manual review or `auto_accept_issue_review=true` may merge/commit it.
12. In every gate-bearing phase, record launched seat ids, wait for completion, normalize the verdicts, and do not advance while any required gate subagent is still running.
13. Before each unattended gate-bearing batch, keep active seats within the rendered topology, close final-state seats before spawning more, and treat `EMFILE` / `Too many open files` as a tool-resource blocker that requires recovery plus rerunning the current gate from disk.
14. Repeat for the next approved issue, then run a change-level `/review`.
15. After that review passes, run the required automated test/validation plus automated manual verification as the final closeout step before the change-level acceptance decision, `verify`, and `archive`. For frontend or other browser-visible changes, prefer chrome devtools MCP to drive the affected main path in that final closeout step; only fall back to another browser tool when chrome devtools MCP is unavailable.

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
- If a spawned seat subagent already has explicit role instructions, do not tell it to route through `subagent-team` or reuse main-session fallback logic.
- Remind the user that the coordinator should create or reuse the issue workspace before handing the issue to a bounded execution subagent.
- Remind the user that the installed template defaults to one change-level worktree reused across serial issues; issue-level `.worktree/<change>/<issue>` remains opt-in.
- Remind the user that subagent-team is the default coordinator topology when delegation is available.
- Remind the user that if the current runtime does not support delegation, the fallback is still issue-mode plus one approved issue at a time in the main session, not the old detached-worker runtime.
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
- if delegation is unavailable, keep the same packet and round contract but run it serially in the main session
- use role-based launch settings: design-author and code-writing subagents `high`, all other subagents `medium`
- keep gate-bearing review/check subagents alive until their completion states and verdicts are explicitly collected
- treat `EMFILE` / `Too many open files` as a recover-and-rerun gate blocker, not as a passed or failed verdict
- once a seat reaches final status and its result is written into the round output or gate artifact, close that finished subagent before launching more seats

## Special Path: `reconcile`

If the user asks to sync issue outputs, collect issue progress, or continue a complex change after issue execution artifacts have been written, prefer `openspec-reconcile-change`.

Reconcile is the default first step when:

- `issues/*.progress.json` already exists for the change
- `issues/*.team.dispatch.md`, `runs/ISSUE-PLANNING.json`, or `control/ACTIVE-SEAT-DISPATCH.json` already exists for the change
- the user says “继续当前 change” after issue-mode work
- the user says “开始做 / 开始实现 / 直接落地” after issue-mode artifacts already exist
- the user asks whether the coordinator can continue automatically

## Preferred Issue Execution Path

Read `references/router/coordinator-playbook.md`.

Summary rule:

- `subagent-team` is the default issue-mode coordinator entry
- `dispatch-issue` prepares the issue workspace and source-of-truth dispatch when execution is explicitly narrowed to one issue-only subagent
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
- `dispatch-issue` -> read the selected `ISSUE-*.md`, create or reuse the issue workspace when appropriate, render the team dispatch by default and the single-issue dispatch only when explicitly narrowed, and prefer the next pending issue from reconcile when the user did not specify one
- `execute-issue` -> read `references/issue-mode-contract.md` plus repo defaults, implement only the assigned issue, write `issues/ISSUE-*.progress.json` and `runs/RUN-*.json`, and do not update `tasks.md`
- `reconcile` -> read `references/issue-mode-contract.md`, inspect `openspec/changes/<name>/issues/ISSUE-*.md`, `openspec/changes/<name>/issues/*.progress.json`, and `openspec/changes/<name>/runs/*.json`, update coordinator-owned checklists if needed, then choose the next OpenSpec action
- `verify` -> compare tasks, specs, design, and implementation using `openspec status`, change artifacts, and code evidence
- `sync-specs` -> merge delta specs from `openspec/changes/<name>/specs/` into `openspec/specs/`
- `archive` -> prefer `openspec-extensions archive change --repo-root . --change "<name>"`; if readiness is unclear, verify first

## IM-Friendly Output Style

- Prefer natural confirmations like “我先帮你把 proposal / design 补齐，先过设计评审，再进入任务拆分或实现” instead of telling the user to type a command.
- Mention raw commands only if the user explicitly asks what happened underneath.
- When the route is inferred, say it in one short line.

## Examples

Read `references/router/examples.md`.
