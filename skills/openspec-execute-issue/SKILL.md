---
name: openspec-execute-issue
description: Execute exactly one issue in an OpenSpec multi-session change. Use when a worker session is told to handle one issue only, with boundaries such as “Issue: ISSUE-001”, “Allowed scope”, “Out of scope”, “Done when”, or similar issue-scoped implementation instructions.
---

# OpenSpec Execute Issue

Use this skill for worker sessions in OpenSpec issue-mode.

Read these before writing any workflow artifacts:

- `../openspec-chat-router/references/issue-mode-contract.md`
- `../openspec-chat-router/references/issue-mode-config.md`

## Rules

- Execute one issue only.
- Do not update `tasks.md`.
- Do not run `verify` or `archive`.
- Treat `issues/<issue-id>.progress.json` as the worker-owned source of truth.
- Write a run artifact under `runs/` for this worker session.

## Required Inputs

Do all non-blocked work first, then ask one short question only if one of these is missing and risky:

- change name
- issue id
- allowed scope
- done condition

## Workflow

1. Resolve the change name and read:
   - `openspec/changes/<change>/proposal.md` if present
   - `openspec/changes/<change>/design.md` if present
   - `openspec/changes/<change>/tasks.md`
   - `openspec/changes/<change>/issues/<issue-id>.md` if present
2. Start worker state with the bundled helper:
   ```bash
   python3 .codex/skills/openspec-execute-issue/scripts/update_issue_progress.py start \
     --repo-root . \
     --change "<change-name>" \
     --issue-id "<issue-id>" \
     --status in_progress \
     --boundary-status working \
     --next-action continue_issue \
     --summary "已开始处理该 issue。"
   ```
   Save the returned `run_id`.
3. Implement only the assigned issue.
4. Run the validation commands defined for the issue:
   - first use `issues/<issue-id>.md` frontmatter `validation`
   - if that field is missing, fall back to `openspec/issue-mode.json`
   - only fall back to `pnpm lint` and `pnpm type-check` when the repo did not configure anything else
5. Before stopping, update the same issue progress and run artifacts:
   ```bash
   python3 .codex/skills/openspec-execute-issue/scripts/update_issue_progress.py stop \
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
