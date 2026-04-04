---
name: openspec-dispatch-issue
description: Generate source-of-truth dispatch artifacts for one OpenSpec issue, prepare a subagent handoff, or create/reuse the issue workspace boundary. Use when the coordinator asks for “ISSUE-001 的派发模板”, “派发下一个 issue”, “创建 ISSUE-001 的 issue workspace”, “准备 issue workspace”, “直接开 subagent 做 ISSUE-001”, or similar requests after issue docs already exist.
---

# OpenSpec Dispatch Issue

Use this skill in the coordinator session after issue docs have been created.

## Session Startup Update Check

- 如果这是当前主会话首次触发任一 `openspec-extensions` skill，先做一次非阻塞版本检查，再继续本 skill 的 dispatch 流程。
- 如果仓库里有 `openspec/openspec-extensions.json`，先读取其中的 `installed_version` 作为仓库记录版本。
- 版本检查优先比较 npm 最新版本与仓库记录版本；如果仓库元数据缺失，再退回比较当前已安装 CLI 版本。
- 版本检查只做 best-effort；检查失败时直接跳过，不要影响 issue dispatch。
- 如果发现 npm 有更新版本，只打印一条高亮提醒，然后继续执行，不要把升级当成当前 dispatch 的 blocker。
- 高亮提醒统一使用这句：
  - `【更新提醒】检测到 openspec-extensions 有新版本。可先退出到命令行执行 \`npm update -g openspec-extensions\` 更新 openspec-extensions，再执行 \`openspec-ex install --target-repo /path/to/your/project --force --force-config\` 刷新当前仓库插件；当前流程继续，不受这条提醒影响。`

Read `issue-mode-contract.md`, `issue-mode-config.md`, `issue-mode-rra.md`, and `router/coordinator-playbook.md` first.

## Workflow

1. Resolve the change and issue. If the user did not name an issue, prefer the recommended pending issue from `openspec-reconcile-change`.
2. Read the latest change-level control artifacts when they exist and confirm that the issue is approved for dispatch in the current round.
3. If issue-planning or acceptance `Must fix now` items still block this dispatch, stop and fix the backlog first.
4. Create or reuse the issue workspace boundary (`worker_worktree`):
   ```bash
   openspec-extensions worktree create \
     --repo-root . \
     --change "<change-name>" \
     --issue-id "<issue-id>"
   ```
   If the user only wants to preview the target path without creating it yet, add `--dry-run`.
5. Render the team dispatch first for the default subagent-team path:
   ```bash
   openspec-extensions dispatch issue-team \
     --repo-root . \
     --change "<change-name>" \
     --issue-id "<issue-id>"
   ```
6. If the user explicitly wants one bounded issue-only handoff instead of the default subagent-team round, also render the standard issue dispatch:
   ```bash
   openspec-extensions dispatch issue \
     --repo-root . \
     --change "<change-name>" \
     --issue-id "<issue-id>"
   ```
7. Use the generated dispatch artifact plus the created/reused workspace as the source of truth when sending work to the coordinator-owned subagent team, or to one bounded issue-only subagent when the user explicitly narrowed the path.
8. In runtimes with delegation:
   - default to `ISSUE-*.team.dispatch.md` for the approved issue round
   - use `ISSUE-*.dispatch.md` only when the user explicitly narrowed execution to one issue-only subagent
9. If the runtime does not support delegation:
   - keep the generated team dispatch as the source-of-truth round contract
   - let the coordinator main session execute that one approved issue locally inside the same workspace boundary
   - still write issue-local progress / run artifacts before reconcile
10. Keep implementation inside that issue workspace and return review, acceptance, and commit to the coordinator.

## Rules

- Dispatch must be generated from the issue doc on disk.
- Issue workspace defaults come from `worker_worktree` in `openspec/issue-mode.json`.
- Shared workspace mode materializes `worker_worktree: .`.
- Change worktree mode reuses one `.worktree/<change-name>/` workspace across all issues in the same change; this is the recommended isolated mode for serial issue execution.
- Issue worktree mode falls back to `.worktree/<change-name>/<issue-id>/` only when a repo truly needs issue-level isolation or parallel issue execution.
- Do not improvise scope boundaries from memory when an issue doc exists.
- If the issue doc is missing required frontmatter fields, fix the issue doc first.
- If the active change-level round still has unresolved `Must fix now` items that block dispatch, do not launch issue execution yet.
- Default to rendering `ISSUE-*.team.dispatch.md`; only use the single-issue dispatch when the user explicitly narrows execution.
- The coordinator owns handoff, review, merge, and final commit for the issue.
- Dispatch artifacts are for coordinator-owned execution; `ISSUE-*.team.dispatch.md` is the default complex-change handoff, even when the coordinator must execute the round locally because delegation is unavailable.

## Output

Prefer a short coordinator response:

```text
已为 `ISSUE-001` 准备 issue dispatch。

- Team Dispatch: openspec/changes/<change>/issues/ISSUE-001.team.dispatch.md
- Dispatch: openspec/changes/<change>/issues/ISSUE-001.dispatch.md
- Issue workspace (`worker_worktree`): .
- Workspace status: shared / created / reused
- Round gate: approved for dispatch
- 默认下一步是把 team dispatch 交给 coordinator 主会话编排 subagent team
```
