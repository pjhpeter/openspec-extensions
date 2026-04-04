---
name: openspec-execute-issue
description: 'Execute exactly one issue in an OpenSpec multi-session change. Use when a worker subagent is told to handle one issue only, with boundaries such as "Issue: ISSUE-001", "Allowed scope", "Out of scope", "Done when", or similar issue-scoped implementation instructions.'
---

# OpenSpec Execute Issue

Use this skill in one worker subagent context only.

## Session Startup Update Check

- 如果这个 worker 会话其实是用户直接启动的顶层会话，并且这是当前会话首次触发任一 `openspec-extensions` skill，先做一次非阻塞版本检查，再继续当前 issue 执行。
- 如果这是 coordinator 派生出来的 seat / worker 子会话，不要重复版本提醒；主会话提醒一次就够了。
- 如果仓库里有 `openspec/openspec-extensions.json`，先读取其中的 `installed_version` 作为仓库记录版本。
- 版本检查优先比较 npm 最新版本与仓库记录版本；如果仓库元数据缺失，再退回比较当前已安装 CLI 版本。
- 版本检查只做 best-effort；检查失败时直接跳过，不要阻塞当前 issue 执行。
- 如果发现 npm 有更新版本，只打印一条高亮提醒，然后继续执行，不要把升级当成当前 issue 的 blocker。
- 高亮提醒统一使用这句：
  - `【更新提醒】检测到 openspec-extensions 有新版本。可先退出到命令行执行 \`npm update -g openspec-extensions\` 更新 openspec-extensions，再执行 \`openspec-ex install --target-repo /path/to/your/project --force --force-config\` 刷新当前仓库插件；当前流程继续，不受这条提醒影响。`

Read `../openspec-chat-router/references/issue-mode-contract.md`, `../openspec-chat-router/references/issue-mode-config.md`, and `../openspec-chat-router/references/issue-mode-rra.md` first.

If the change name, issue id, allowed scope, or done condition is missing and risky, do all non-blocked work first and then ask one short question.

## Workflow

1. Resolve the change name and read:
   - `openspec/changes/<change>/proposal.md` if present
   - `openspec/changes/<change>/design.md` if present
   - `openspec/changes/<change>/tasks.md`
   - `openspec/changes/<change>/issues/<issue-id>.md` if present
   - `openspec/changes/<change>/control/BACKLOG.md` if present
   - latest `openspec/changes/<change>/control/ROUND-*.md` if present
2. Start worker state with the bundled helper:
   ```bash
   openspec-extensions execute update-progress start \
     --repo-root . \
     --change "<change-name>" \
     --issue-id "<issue-id>" \
     --status in_progress \
     --boundary-status working \
     --next-action continue_issue \
     --summary "已开始处理该 issue。"
   ```
   Save the returned `run_id`.
3. Implement only the assigned issue inside its allowed scope and current approved round scope.
4. Run the validation commands defined for the issue:
   - first use `issues/<issue-id>.md` frontmatter `validation`
   - if that field is missing, fall back to `openspec/issue-mode.json`
   - only fall back to `pnpm lint` and `pnpm type-check` when the repo did not configure anything else
5. Before stopping, update the same issue progress and run artifacts:
   ```bash
   openspec-extensions execute update-progress stop \
     --repo-root . \
     --change "<change-name>" \
     --issue-id "<issue-id>" \
     --run-id "<run-id>" \
     --status completed \
     --boundary-status review_required \
     --next-action coordinator_review \
     --summary "issue 边界内实现已完成，等待 coordinator 收敛。" \
     --validation "<validation-key-1>=passed" \
     --validation "<validation-key-2>=passed" \
     --changed-file "src/example.ts"
   ```
6. Report back with:
   - issue id
   - changed files
   - validation
   - progress artifact path
   - run artifact path
   - whether coordinator action is needed
7. Stop after the handoff. Review, merge, and commit stay with the coordinator unless the user explicitly overrides that rule.

## Rules

- Execute one issue only.
- Treat `issues/<issue-id>.progress.json` as the worker-owned source of truth.
- Write a run artifact under `runs/` for this worker context.
- Do not update `tasks.md`, run `verify` or `archive`, self-accept the worker workspace, or create the final git commit.
- If you discover out-of-scope gaps, report them as blockers or backlog candidates for the coordinator instead of silently widening the issue.
- This contract is the same whether the worker is a spawned subagent or a separately launched worker session.

## Blocker Handling

If blocked:

1. Stop implementation.
2. Record `status=blocked`, `boundary_status=blocked`, and a concrete `blocker`.
3. Ask the coordinator for the next decision instead of guessing.

## Output Style

Keep the worker report short and structured. Prefer:

```text
Issue: ISSUE-001
Files: src/example.ts
Validation: lint=passed; typecheck=passed
Progress Artifact: openspec/changes/<change>/issues/ISSUE-001.progress.json
Run Artifact: openspec/changes/<change>/runs/RUN-...-ISSUE-001.json
Need Coordinator Update: yes
```
