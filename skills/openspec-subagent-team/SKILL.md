---
name: openspec-subagent-team
description: Coordinate an OpenSpec change or issue through a subagent team development -> check -> repair -> review loop. Use as the default coordinator entry path for complex issue-mode work, or whenever a bounded multi-round control plane is needed.
---

# OpenSpec Subagent Team

Use this skill in the coordinator session as the default entry path for the whole OpenSpec complex-change lifecycle.

Read these first:

- `../openspec-chat-router/references/issue-mode-contract.md`
- `../openspec-chat-router/references/issue-mode-rra.md`
- `../openspec-chat-router/references/router/coordinator-playbook.md`
- `references/team-templates.md`

## Purpose

- make subagent team orchestration the primary path for complex issue-mode work
- keep round scope, backlog, and review decisions on disk
- avoid relying on detached worker fallback infrastructure
- let `subagent_team.*` govern the whole lifecycle from spec-readiness through archive, including whether coordinator-owned review gates are auto-accepted

## Workflow

1. Resolve the target change first, not just the issue.
2. Render the lifecycle packet:
   ```bash
   python3 .codex/skills/openspec-subagent-team/scripts/render_change_lifecycle_dispatch.py \
     --repo-root . \
     --change "<change-name>"
   ```
3. Read the packet it generates under:
   - `openspec/changes/<change>/control/SUBAGENT-TEAM.dispatch.md`
4. Treat the rendered phase as the source of truth for where the change currently is:
   - `spec_readiness`
   - `issue_planning`
   - `issue_execution`
   - `change_acceptance`
   - `change_verify`
   - `ready_for_archive`
5. If the current phase is issue execution, also render the issue packet:
   ```bash
   python3 .codex/skills/openspec-dispatch-issue/scripts/render_subagent_team_dispatch.py \
     --repo-root . \
     --change "<change-name>" \
     --issue-id "<issue-id>"
   ```
6. Keep the main agent as control plane owner:
   - define or confirm the round target
   - dedupe findings into one normalized backlog
   - decide stop / continue
   - when an enabled `auto_accept_*` gate becomes eligible, continue immediately instead of asking the user to review first
7. Use a fixed topology by default:
   - development group: 3 subagents
   - check group: 3 subagents
   - review group: 3 subagents
8. Run the loop:
   - development
   - check
   - repair
   - review
   - if review fails, go back to development
9. Developers that implement code for the issue must follow `openspec-execute-issue` and write issue progress/run artifacts.
10. Coordinator keeps merge, commit, verify, archive, and change-level control artifacts.

## Rules

- This is the default entry path for complex issue-mode execution.
- Use the single-worker issue path only when the user explicitly narrows execution to one bounded issue worker, or the current step clearly only needs one issue-local implementation context.
- `subagent_team.*` now controls full-process auto-accept and continuation, not just the design-review checkpoint.
- `semi_auto` means the lifecycle pauses after each review gate; `full_auto` means the lifecycle auto-continues across `spec_readiness -> issue_planning -> issue_execution -> change_acceptance -> change_verify -> archive` while still respecting RRA gates.
- `spec_readiness` is the design-review gate in the complex-change path: proposal/design are prepared first, then 3 review subagents must pass it before task splitting begins.
- `issue_planning` starts after design review passes, and is where coordinator-owned `tasks.md` plus `issues/INDEX.md` and `ISSUE-*.md` are produced/reviewed.
- `auto_accept_spec_readiness=true` means spec-readiness does not wait for human sign-off once proposal/design have passed the 3-subagent design review.
- `auto_accept_issue_planning=true` means issue planning does not wait for human sign-off once tasks.md plus INDEX/ISSUE docs are dispatch-ready.
- `auto_accept_issue_review=true` means eligible `review_required` issues are coordinator-accepted, merged, and committed automatically once issue-local validation passes.
- `auto_accept_change_acceptance=true` means change acceptance does not wait for human sign-off once verify is allowed.
- One issue stays one bounded execution unit even when multiple subagents participate in the round.
- Do not pass raw checker notes directly to developers; normalize first.
- Reject style-only churn unless it affects correctness, delivery risk, or acceptance.
- If the loop stalls after two or three rounds, shrink scope or tighten the review target instead of expanding the backlog.
- Do not replace coordinator-owned merge/commit/verify/archive with worker self-management.
- Keep `worker_worktree` as the issue boundary; it is part of the active contract, not legacy baggage.

## Output

Keep coordinator output short:

```text
已切到 subagent team 主链。

- Team Dispatch: openspec/changes/<change>/issues/ISSUE-001.team.dispatch.md
- Round Target: <summary>
- Next Step: development / check / review
```
