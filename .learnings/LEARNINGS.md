## [LRN-20260403-001] correction

**Logged**: 2026-04-03T00:00:00+08:00
**Priority**: high
**Status**: pending
**Area**: config

### Summary
不要把 subagent-team 的 development seat 当成完整 issue worker

### Details
在 `issue_execution` 的 subagent-team 路径里，development seat 被允许沿用 `openspec-execute-issue` 的整套合同，导致单个开发 seat 会在 worktree 里把 issue 直接推进到 `completed + review_required`，随后 coordinator 还能在缺少 team checker/reviewer gate 的情况下 merge/commit。用户明确指出这会把开发、检查、审查的职责混在一起，并让主分支上的 checker/reviewer 变成事后补跑。

### Suggested Action
对 team dispatch issue 强制区分 development seat 与 issue-only worker：development seat 只允许写 `start` / `checkpoint`，checker/reviewer 通过后由 coordinator 写 issue review gate artifact，并且在 gate 缺失时阻止 reconcile/merge 自动接受 issue。

### Metadata
- Source: user_feedback
- Related Files: src/renderers/issue-team-dispatch.ts, src/commands/reconcile.ts, src/commands/merge-issue.ts
- Tags: openspec, subagent-team, issue-execution, gate

---
