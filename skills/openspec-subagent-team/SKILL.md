---
name: openspec-subagent-team
description: Coordinate an OpenSpec change or issue through a subagent team development -> check -> repair -> review loop. Use when the user explicitly asks for subagent team collaboration or needs a bounded multi-round control plane for complex issue-mode work.
---

# OpenSpec Subagent Team

Use this skill in the coordinator session when the user explicitly wants subagent team collaboration for the whole OpenSpec complex-change lifecycle.

Read these first:

- `../openspec-chat-router/references/issue-mode-contract.md`
- `../openspec-chat-router/references/issue-mode-rra.md`
- `../openspec-chat-router/references/router/coordinator-playbook.md`
- `references/team-templates.md`

## Purpose

- make subagent team orchestration the primary path for complex issue-mode work
- keep round scope, backlog, and review decisions on disk
- avoid relying on detached worker fallback infrastructure

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
4. If the current phase is issue execution, also render the issue packet:
   ```bash
   python3 .codex/skills/openspec-dispatch-issue/scripts/render_subagent_team_dispatch.py \
     --repo-root . \
     --change "<change-name>" \
     --issue-id "<issue-id>"
   ```
5. Keep the main agent as control plane owner:
   - define or confirm the round target
   - dedupe findings into one normalized backlog
   - decide stop / continue
6. Use a fixed topology by default:
   - development group: 3 subagents
   - check group: 3 subagents
   - review group: 3 subagents
7. Run the loop:
   - development
   - check
   - repair
   - review
   - if review fails, go back to development
8. Developers that implement code for the issue must follow `openspec-execute-issue` and write issue progress/run artifacts.
9. Coordinator keeps merge, commit, verify, archive, and change-level control artifacts.

## Rules

- Only use this path when the user explicitly asks for subagents / team collaboration, or when the request already assumes subagent-team orchestration.
- `subagent_team.auto_advance_after_design_review` controls whether spec-readiness review passes should automatically continue into issue planning. Default should stay `false` unless the repo explicitly wants unattended continuation after design review.
- One issue stays one bounded execution unit even when multiple subagents participate in the round.
- Do not pass raw checker notes directly to developers; normalize first.
- Reject style-only churn unless it affects correctness, delivery risk, or acceptance.
- If the loop stalls after two or three rounds, shrink scope or tighten the review target instead of expanding the backlog.
- Do not replace coordinator-owned merge/commit/verify/archive with worker self-management.

## Output

Keep coordinator output short:

```text
已切到 subagent team 主链。

- Team Dispatch: openspec/changes/<change>/issues/ISSUE-001.team.dispatch.md
- Round Target: <summary>
- Next Step: development / check / review
```
