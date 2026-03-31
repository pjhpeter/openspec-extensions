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
7. Use a phase-specific topology:
   - `spec_readiness`: 1 design author (`reasoning_effort=xhigh`) + 2 design reviewers (`reasoning_effort=medium`)
   - `issue_planning`: fast path is `2 development + 1 check + 1 review`, all `reasoning_effort=medium`
   - `issue_execution`: fast path is `3 development + 2 check + 1 review`; code-writing development seats use `reasoning_effort=xhigh`, check/review use `reasoning_effort=medium`
   - `change_acceptance` / `ready_for_archive`: fast path is `1 development + 1 check + 1 review`, all `reasoning_effort=medium`
   - `change_verify`: fast path is `2 development + 1 check + 1 review`; code-fix development seats use `reasoning_effort=xhigh`, check/review use `reasoning_effort=medium`
8. When spawning subagents, explicitly set `reasoning_effort` instead of inheriting the session default.
9. Treat every launched seat in the current phase as a gate-bearing participant, not a disposable sidecar:
   - record the agent id, seat name, and current status
   - use `default` or `worker` style delegation for these gate-bearing seats; do not launch check/review gate seats as `explorer`
   - when the phase depends on their verdicts, wait up to 1 hour for completion instead of short polling
   - do not accept the phase, mark it passed, or close those subagents while any required gate-bearing seat is still running
10. `auto_accept_*` only removes human chat sign-off after the gate team has finished:
   - it does not mean "spawned already, so the phase may pass"
   - it does not allow skipping review/check verdict collection
   - it does not allow closing unfinished gate-bearing subagents early
11. Run the loop:
   - development
   - check
   - repair
   - review
   - if review fails, go back to development
12. Developers that implement code for the issue must follow `openspec-execute-issue` and write issue progress/run artifacts.
13. After all issues are complete, run a change-level `/review` and write `runs/CHANGE-REVIEW.json` before verify.
14. Coordinator keeps merge, commit, verify, archive, and change-level control artifacts.

## Rules

- This is the default entry path for complex issue-mode execution.
- Use the single-worker issue path only when the user explicitly narrows execution to one bounded issue worker, or the current step clearly only needs one issue-local implementation context.
- `subagent_team.*` now controls full-process auto-accept and continuation, not just the design-review checkpoint.
- `semi_auto` means the lifecycle pauses after each review gate; `full_auto` means the lifecycle auto-continues across `spec_readiness -> issue_planning -> issue_execution -> change_acceptance -> change_verify -> archive` while still respecting RRA gates.
- `spec_readiness` is the design-review gate in the complex-change path: proposal/design are prepared first, then a dedicated `1` author + `2` reviewers subagent team must pass it before task splitting begins.
- `issue_planning` starts after design review passes, and is where coordinator-owned `tasks.md` plus `issues/INDEX.md` and `ISSUE-*.md` are produced/reviewed.
- `issue_planning` and `issue_execution` should start with the lighter fast path first; only escalate more check/review seats when the current round surfaces cross-boundary risk or unresolved evidence gaps.
- Gate-bearing phase subagents are part of the acceptance barrier for that phase, not informational helpers.
- `auto_accept_*` means "skip human sign-off after the gate team has finished and passed", not "advance immediately after spawn".
- Do not mark a phase passed while any gate-bearing reviewer/checker for that phase is still running.
- Do not close unfinished gate-bearing subagents just because the coordinator thinks the phase outcome is obvious.
- Gate-bearing review/check subagents must not be launched as `explorer`; treat them as gate owners whose completion status must be collected explicitly.
- 在 `issue_execution` 里，开发组 / 检查组 / 审查组仍沿用 `rra` 的 lens 家族，但默认快路径只激活最小必要 seat：
  - Development 1/2/3 = core implementation / dependent integration / tests-cleanup
  - Check 1/2/3 = functional correctness / architecture-dataflow escalation / regression-evidence
  - Review 1/2/3 = target path / regression-operational escalation / evidence completeness escalation
- checker / reviewer 默认先看 `changed_files`（若已有 progress artifact），没有时再看 `allowed_scope` 和 issue validation；只有确认 direct dependency 风险时才允许向外扩。
- issue round 的 check/review 默认不做 repo-wide 扫描，也不要读取 `node_modules`、`dist`、`build`、`.next`、`coverage` 这类目录，除非当前 issue 明确把这些路径放进 `allowed_scope`。
- design-author subagents use `reasoning_effort=xhigh`.
- code-writing subagents use `reasoning_effort=xhigh`.
- design reviewers, planning authors, checkers, reviewers, and closeout-only subagents use `reasoning_effort=medium`.
- `auto_accept_spec_readiness=true` means spec-readiness does not wait for human sign-off once proposal/design have passed the `1` author + `2` reviewers design review.
- `auto_accept_issue_planning=true` means issue planning does not wait for human sign-off once tasks.md plus INDEX/ISSUE docs are dispatch-ready.
- `auto_accept_issue_review=true` means eligible `review_required` issues are coordinator-accepted, merged, and committed automatically once issue-local validation passes.
- `auto_accept_change_acceptance=true` means change acceptance does not wait for human sign-off once a passed change-level `/review` has already made verify allowed.
- unattended progression should use long blocking waits for gate-bearing subagents, typically up to 1 hour
- One issue stays one bounded execution unit even when multiple subagents participate in the round.
- Do not pass raw checker notes directly to developers; normalize first.
- Reject style-only churn unless it affects correctness, delivery risk, or acceptance.
- If the loop stalls after two or three rounds, shrink scope or tighten the review target instead of expanding the backlog.
- Do not replace coordinator-owned merge/commit/verify/archive with worker self-management.
- Do not skip the change-level `/review` step between "all issues completed" and `verify`.
- Keep `worker_worktree` as the issue boundary; it is part of the active contract, not legacy baggage.

## Output

Keep coordinator output short:

```text
已切到 subagent team 主链。

- Team Dispatch: openspec/changes/<change>/issues/ISSUE-001.team.dispatch.md
- Round Target: <summary>
- Next Step: development / check / review
```
