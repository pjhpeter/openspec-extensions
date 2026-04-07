# OpenSpec Chat Router Examples

Use these examples when you need quick intent-to-route references without re-reading the full router skill.

- “进入 openspec 模式。” -> print the cheat sheet
- “进入 openspec 模式，然后帮我起一个变更。” -> print the cheat sheet, then route to `propose`
- “这个任务很复杂，按 issue 模式继续。” -> print the issue-mode template, then default to `subagent-team` once the target change is concrete
- “按 issue 模式继续 `add-infinite-canvas-node-naming`。” -> print the issue-mode template, then continue that change through `subagent-team`
- “先对这个 change 做设计评审，通过后再决定能不能拆 issue。” -> readiness review before `plan-issues`
- “把这个 change 拆成几个可并行 issue。” -> `plan-issues`
- “先 review 这个 change 的 issue 规划，再决定 dispatch 哪个 issue。” -> `plan-issues`, then change-level issue-planning review
- “给我 ISSUE-001 的派发模板。” -> `dispatch-issue`
- “给 ISSUE-001 创建 issue workspace。” -> `dispatch-issue`
- “给 ISSUE-001 准备 team dispatch 并直接开一个 subagent team。” -> `dispatch-issue`, then coordinator-owned subagent team
- “继续这个复杂 change，不特别指定 ISSUE。” -> `subagent-team`
- “这个 issue-only subagent 只做 ISSUE-002。” -> `execute-issue`
- “同步一下当前 change 的 issue 进度。” -> `reconcile`
- “根据 issue 结果继续推进这个 change。” -> `reconcile`
- “这个 change 已经拆过 issue，现在开始实现。” -> `reconcile`, then continue through `subagent-team`
- “对这个 change 做 change-level acceptance review，再决定要不要 verify。” -> `reconcile`, then change-level acceptance decision
- “这个需求我还没想清楚，你先帮我梳理一下。” -> `explore`
- “帮我起一个登录重构的变更，把文档一次性补齐。” -> `propose`
- “先建个 change，我想先看第一步文档模板。” -> `new`
- “把当前 change 的文档补齐到可以开始做。” -> `ff`
- “继续刚才那个 change。” -> `continue`
- “现在开始实现这个变更。” -> `apply` when the change has not entered issue-mode yet
- “检查一下当前变更能不能归档。” -> `verify`
- “把这个 change 的 delta spec 同步到主 spec。” -> `sync-specs`
- “这个变更做完了，帮我归档。” -> `archive`
