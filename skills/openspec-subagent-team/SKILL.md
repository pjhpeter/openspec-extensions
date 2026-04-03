---
name: openspec-subagent-team
description: Coordinate an OpenSpec change or issue through a subagent team development -> check -> repair -> review loop. Use as the default coordinator entry path for complex issue-mode work, or whenever a bounded multi-round control plane is needed.
---

# OpenSpec Subagent Team

Use this skill in the coordinator session as the default entry path for the whole OpenSpec complex-change lifecycle.
If the current session already has an explicit seat-local handoff, do not use this skill as the seat's planner; that seat contract overrides inherited coordinator defaults.

Read these first:

- `../openspec-chat-router/references/issue-mode-contract.md`
- `../openspec-chat-router/references/issue-mode-config.md`
- `../openspec-chat-router/references/issue-mode-rra.md`
- `../openspec-chat-router/references/router/coordinator-playbook.md`
- `references/team-templates.md`
- `openspec/issue-mode.json` if the repo has one

## Purpose

- make subagent team orchestration the primary path for complex issue-mode work
- keep round scope, backlog, and review decisions on disk
- avoid relying on detached worker fallback infrastructure
- let `subagent_team.*` govern the whole lifecycle from spec-readiness through archive, including whether coordinator-owned review gates are auto-accepted

## Workflow

1. Resolve the target change first, not just the issue.
2. Render the lifecycle packet:
   ```bash
   openspec-extensions dispatch lifecycle \
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
5. Before starting the current phase, reread `openspec/issue-mode.json` when it exists and restate the active rules that can affect execution:
   - `worker_worktree.*`
   - `validation_commands`
   - `rra.gate_mode`
   - `subagent_team.*`
   - if the config changed since the previous phase, treat the latest file contents as authoritative and adjust the plan before spawning phase seats
6. If the current phase is issue execution, also render the issue packet:
   ```bash
   openspec-extensions dispatch issue-team \
     --repo-root . \
     --change "<change-name>" \
     --issue-id "<issue-id>"
   ```
7. Keep the main agent as control plane owner:
   - define or confirm the round target
   - dedupe findings into one normalized backlog
   - decide stop / continue
   - when an enabled `auto_accept_*` gate becomes eligible, continue immediately instead of asking the user to review first
   - if reconcile emits `commit_planning_docs`, run the coordinator-owned planning-doc commit immediately before any first issue dispatch
   - if reconcile emits `dispatch_next_issue`, treat it as a continuation command, not a terminal control-plane checkpoint
   - the lifecycle packet is coordinator-only; when spawning a seat subagent, pass a seat-local handoff instead of pasting the entire lifecycle packet as its executable task
8. Use a phase-specific topology:
   - `spec_readiness`: 1 design author (`reasoning_effort=xhigh`) + 2 design reviewers (`reasoning_effort=medium`)
   - `issue_planning`: fast path is `2 development + 1 check + 1 review`, all `reasoning_effort=medium`
   - `issue_execution`: fast path is `3 development + 2 check + 1 review`; code-writing development seats use `reasoning_effort=xhigh`, check/review use `reasoning_effort=medium`
   - `change_acceptance` / `ready_for_archive`: fast path is `1 development + 1 check + 1 review`, all `reasoning_effort=medium`
   - `change_verify`: fast path is `2 development + 1 check + 1 review`; code-fix development seats use `reasoning_effort=xhigh`, check/review use `reasoning_effort=medium`
9. If the current runtime does not support delegation at all:
   - keep the main session as both coordinator and executor
   - treat the rendered lifecycle packet and issue team packet as the source of truth for the current round
   - run the same `development -> check -> repair -> review` loop serially in the main session
   - keep issue boundaries, progress artifacts, run artifacts, reconcile, review, verify, and archive unchanged
   - do not invent a detached-worker fallback runtime
10. When spawning subagents, explicitly set `reasoning_effort` instead of inheriting the session default.
11. If a spawned seat subagent detects that inherited context still contains coordinator defaults:
   - ignore those inherited coordinator/router defaults
   - follow the seat-local handoff
   - do not create control artifacts, tasks, issue docs, dispatch packets, or worktrees unless the seat contract explicitly allows it
   - if runtime limitations prevent returning the seat result cleanly, report the seat-local blocker and stop instead of activating serial fallback
12. Treat every launched seat in the current phase as a gate-bearing participant, not a disposable sidecar:
   - record the agent id, seat name, and current status
   - use `default` or `worker` style delegation for these gate-bearing seats; do not launch check/review gate seats as `explorer`
   - when the phase depends on their verdicts, wait up to 1 hour for completion instead of short polling
   - do not accept the phase, mark it passed, or close those subagents while any required gate-bearing seat is still running
13. `auto_accept_*` only removes human chat sign-off after the gate team has finished:
   - it does not mean "spawned already, so the phase may pass"
   - it does not allow skipping review/check verdict collection
   - it does not allow closing unfinished gate-bearing subagents early
   - it does not allow a seat subagent to self-promote into coordinator and continue later phases on its own
14. Run the loop:
   - development
   - check
   - repair
   - review
   - if review fails, go back to development
15. Only the explicit issue-only worker path uses `openspec-execute-issue` end to end. In `issue_execution` team rounds, development seats may write `start` / `checkpoint` issue progress updates, but must not close the issue as `completed + review_required`; the coordinator does that only after checker/reviewer gates pass and `runs/ISSUE-REVIEW-<issue>.json` is recorded.
16. Before moving from one lifecycle phase to the next, reread `openspec/issue-mode.json` again and confirm the next phase still matches the latest config.
17. After all issues are complete, run a change-level `/review` and write `runs/CHANGE-REVIEW.json` before verify.
18. Coordinator keeps merge, commit, verify, archive, and change-level control artifacts.

## Rules

- This is the default entry path for complex issue-mode execution.
- Use the single-worker issue path only when the user explicitly narrows execution to one bounded issue worker, or the current step clearly only needs one issue-local implementation context.
- If the runtime does not support delegation, fall back to the main-session serial issue path instead of blocking on `subagent-team`.
- `subagent_team.*` now controls full-process auto-accept and continuation, not just the design-review checkpoint.
- `semi_auto` means the lifecycle still keeps manual gates for design / planning / change acceptance / archive. It may still auto-accept validated issues one by one so each issue lands as its own commit. `full_auto` means the lifecycle auto-continues across `spec_readiness -> issue_planning -> issue_execution -> change_acceptance -> change_verify -> archive` while still respecting RRA gates.
- `spec_readiness` is the design-review gate in the complex-change path: proposal/design are prepared first, then a dedicated `1` author + `2` reviewers subagent team must pass it before task splitting begins.
- `spec_readiness` 通过后，coordinator 还要把当前 gate 结果写成 `runs/SPEC-READINESS.json`；缺这个工件时，后续 tasks / issue 文档不能把 phase 顶过去。
- design-author / design-review seats are not coordinator substitutes: they must not create worktrees, write issue progress artifacts, dispatch issues, or continue into issue execution.
- if inherited context or default agent prompts conflict with an explicit seat handoff, the seat handoff wins.
- `issue_planning` starts after design review passes, and is where coordinator-owned `tasks.md` plus `issues/INDEX.md` and `ISSUE-*.md` are produced/reviewed.
- `issue_planning` 通过后，coordinator 还要把当前 gate 结果写成 `runs/ISSUE-PLANNING.json`；缺这个工件时，不能开始首个 issue execution。
- `issue_execution` 里如果走的是 team dispatch，development seat 只负责实现、changed_files 和 progress checkpoint；如果当前改动让既有校验失效，只把相关 validation 标回 `pending`，不要在 development seat 内自行宣称校验通过。checker / reviewer 通过后，coordinator 还要把当前 gate 结果写成 `runs/ISSUE-REVIEW-<issue>.json`，然后才能把 issue 标成 `completed + review_required` 并进入 merge。
- if a seat subagent was successfully launched, the fallback rule "main session continues serially when delegation is unavailable" no longer applies to that seat; only the coordinator may use that fallback.
- Before the first issue dispatch, the coordinator must first commit `proposal.md`, `design.md`, `tasks.md`, `issues/INDEX.md`, and `ISSUE-*.md` as a dedicated planning-doc commit.
- When `issue_planning` is auto-accepted and reconcile emits `commit_planning_docs`, the coordinator must commit those planning docs immediately, rerun reconcile, and then honor `dispatch_next_issue`.
- `issue_planning` and `issue_execution` should start with the lighter fast path first; only escalate more check/review seats when the current round surfaces cross-boundary risk or unresolved evidence gaps.
- Gate-bearing phase subagents are part of the acceptance barrier for that phase, not informational helpers.
- `auto_accept_*` means "skip human sign-off after the gate team has finished and passed", not "advance immediately after spawn".
- Before starting any new lifecycle phase, reread `openspec/issue-mode.json` if present; do not rely on a stale config snapshot from an earlier phase.
- If `openspec/issue-mode.json` changed mid-run, the latest file contents override the coordinator's previous assumptions about automation, validation, worktree scope, and gate mode.
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
- `auto_accept_issue_planning=true` means issue planning does not wait for human sign-off once tasks.md plus INDEX/ISSUE docs are dispatch-ready; the coordinator still commits the planning docs before the first issue dispatch.
- `dispatch_next_issue` means "continue now"; it is not a pause point, not a terminal checkpoint, and not a prompt to wait for another user instruction.
- `auto_accept_issue_review=true` means eligible `review_required` issues are coordinator-accepted, merged, and committed automatically only after issue-local validation passed and the current team review gate artifact also passed.
- `auto_accept_change_acceptance=true` means change acceptance does not wait for human sign-off once a passed change-level `/review` has already made verify allowed.
- unattended progression should use long blocking waits for gate-bearing subagents, typically up to 1 hour
- One issue stays one bounded execution unit even when multiple subagents participate in the round.
- Do not pass raw checker notes directly to developers; normalize first.
- Reject style-only churn unless it affects correctness, delivery risk, or acceptance.
- If the loop stalls after two or three rounds, shrink scope or tighten the review target instead of expanding the backlog.
- Do not replace coordinator-owned merge/commit/verify/archive with worker self-management.
- Do not skip the change-level `/review` step between "all issues completed" and `verify`.
- Keep `worker_worktree` as the issue workspace field.
- Compatibility fallback without repo config is still shared workspace (`.`).
- The installed template now defaults to one change-level worktree (`.worktree/<change>`) reused across that change's serial issues.
- Issue-level isolated worktrees (`.worktree/<change>/<issue>`) remain opt-in for truly parallel or conflict-heavy issue execution.

## Output

Keep coordinator output short:

```text
已切到 subagent team 主链。

- Team Dispatch: openspec/changes/<change>/issues/ISSUE-001.team.dispatch.md
- Round Target: <summary>
- Next Step: development / check / review
```
