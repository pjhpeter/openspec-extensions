---
name: openspec-execute-issue
description: 'Execute exactly one issue in an OpenSpec multi-session change. Use when a worker subagent is told to handle one issue only, with boundaries such as "Issue: ISSUE-001", "Allowed scope", "Out of scope", "Done when", or similar issue-scoped implementation instructions.'
---

# OpenSpec Execute Issue

Use this skill in one worker subagent context only.

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
