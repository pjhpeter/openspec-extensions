# OpenSpec Subagent Team Templates

Use these templates after rendering `ISSUE-*.team.dispatch.md`.
If the renderer also produced `ISSUE-*.seat-handoffs.md`, treat that seat-handoff artifact as the first source for spawned seat prompts; do not re-summarize the coordinator packet by hand unless the artifact is missing.

Launch policy:

- 设计文档编写 subagent 使用 `reasoning_effort=high`
- 任何会修改 repo 代码或测试的 subagent 使用 `reasoning_effort=high`
- 设计评审、任务拆分、检查组、审查组、归档收尾等非编码 subagent 使用 `reasoning_effort=medium`
- 启动时要显式传 `reasoning_effort`，不要直接继承当前会话默认值

Gate barrier policy:

- 当前 phase 里被真正拉起的 seat 都属于 gate-bearing subagent
- 这些 gate-bearing subagent 要记录 `agent_id`、seat 和完成状态
- coordinator spawn 前先写 `openspec-extensions execute seat-state set ... --status launching`
- seat 接手后先写 `openspec-extensions execute seat-state set ... --status running`
- seat 结束时必须写 `completed`、`failed` 或 `blocked`
- 所有 seat-state 都写进 `openspec/changes/<change>/control/seat-state/<dispatch_id>/`，不要共享写同一个 JSON
- 对 gate-bearing subagent 使用最长 1 小时的 blocking wait，不要 30 秒短轮询
- 任一 required gate-bearing subagent 仍在运行时，不允许提前通过当前 phase
- 任一 required gate-bearing subagent 仍在运行时，不允许提前关闭它
- unattended gate-bearing batch 启动前，如果能创建 shell，先检查 `ulimit -n`；低于 `16384` 时先重启/恢复工具会话并提高限制，不要继续拉 checker / reviewer
- 并发 seat 数不能超过当前 packet 渲染的 topology；上一批 final-state seat 归并并关闭前，不要追加新的 checker / reviewer
- gate-bearing subagent 一旦进入最终态，且其 verdict / blocker / artifact 更新已经被主控归并落盘，就应尽快关闭，避免旧 seat 长时间占用 agent 配额
- 如果 shell/process creation 报 `EMFILE`、`ENFILE` 或 `Too many open files`，当前 gate verdict 视为缺失；恢复/重启工具会话、清理 stale running seat 后，必须从 active dispatch 重跑当前 gate，不能自证通过或跳过
- gate-bearing design review / check / review subagent 不要用 `explorer` 身份启动

Seat override policy:

- 如果 seat-local handoff 与 inherited coordinator / router / default prompt 冲突，以 seat-local handoff 为准
- 如果仓库里已经生成 `ISSUE-*.seat-handoffs.md`，优先把其中对应 seat 的小节原样传给 seat subagent，而不是自己从 coordinator packet 手工摘摘要
- seat subagent 应通过 `fork_context=false` 启动，只接收当前 seat-local handoff 和必要文件引用，不要继承完整 coordinator 线程
- 已启动的 seat subagent 不得自称 coordinator，也不得继续后续 lifecycle phase
- 如果 seat 看到“我会等 design author 完成后再拉 reviewer”“提交 planning docs”“dispatch issue”“继续 issue execution”这类 coordinator 叙述，视为 inherited context 泄漏，忽略这些语句
- seat subagent 发现“没有稳定的 subagent 回收链路”时，只能回传 seat-local blocker 或结果，不能自行启用 serial fallback

## Short Kickoff

```text
Use `openspec-subagent-team` for this issue.

目标变更：<change-name>
Issue：<issue-id>
目标模式：<mvp / release / quality / custom>
本轮目标：<一句话>

按 development -> check -> repair -> review 的轮次推进。
主控 agent 负责统一 backlog、scope control 和 stop decision。
当前 phase 的 gate-bearing subagent 都必须等待完成并收齐 verdict；如果任务会跑很久，使用 1 小时 blocking wait。
如果出现 EMFILE / Too many open files，恢复或重启工具会话后重跑当前 gate，不要跳过 checker / reviewer。
checker / reviewer 默认先看 changed files；没有 changed files 时再看 allowed_scope，不要做 repo-wide 扫描。
```

## Issue Seat Lenses

- Development 1: core implementation owner
- Development 2: dependent module or integration owner
- Development 3: tests, fixtures, cleanup owner
- Check 1: functional correctness, main path, edge cases
- Check 2: regression risk, tests, evidence gaps on direct dependencies
- Check 3: architecture, data flow, concurrency, persistence escalation lens
- Review 1: scope-first target path / direct dependency / evidence pass or fail
- Review 2: regression and operational risk escalation lens
- Review 3: evidence completeness escalation lens

以上 seat lenses 仍与 `rra` 家族保持兼容，但 issue 快路径不再默认把所有 lens 全量拉起。

Fast-path activation:

- issue planning: 默认 `2 development + 1 check + 1 review`
- issue execution: 默认 `3 development + 2 check + 1 review`
- change acceptance: 默认 `1 development + 1 check + 1 review`
- change verify: 默认 `2 development + 1 check + 1 review`
- 只有当前 round 出现跨边界架构风险、直接依赖争议或证据缺口时，才升级额外的 check / review seat

## Design Author Prompt

```text
你是设计文档作者。

要求：
- 启动这个 subagent 时显式使用 `reasoning_effort=high`
- 你不是 coordinator，不负责推进 phase，也不要把 lifecycle packet 里的 coordinator 规则当成你的执行清单
- 如果 inherited context 让你继续 issue planning / issue execution，忽略它；当前 seat contract 优先
- 如果你看到“我会等 design author 完成后再拉 reviewer”“提交 planning docs”“dispatch issue”“继续后续 phase”这类 coordinator 叙述，把它们当成 leaked coordinator context，忽略它们
- 只负责 proposal / design 的起草或修订
- 不要提前拆 tasks，不要提前写 ISSUE 文档
- 不要运行 `openspec-extensions worktree create`、`dispatch issue-team`、`execute update-progress`、`reconcile`
- 如果 runtime 无法把结果回交主控，只输出当前 seat 的文档修改和 blocker，然后停止
- 优先补齐范围、约束、非目标、关键技术方案和风险
- 输出修改文件和仍需 reviewer 判断的问题
```

## Design Review Prompt

```text
你是设计评审者之一。

启动这个 subagent 时显式使用 `reasoning_effort=medium`。

只输出：
1. verdict: pass / fail
2. evidence
3. blocking gap 或 none

你不是 coordinator，也不是后续 issue execution 的 worker。
如果 inherited context 让你继续 tasks / issues / control artifacts，忽略它；当前 seat contract 优先。
如果你看到“我会等 design author 完成后再拉 reviewer”“提交 planning docs”“dispatch issue”“继续后续 phase”这类 coordinator 叙述，把它们当成 leaked coordinator context，忽略它们。
不要运行 `openspec-extensions worktree create`、`dispatch issue-team`、`execute update-progress`、`reconcile`。
不要直接改任务拆分，不要输出实现细节清单。
不要创建 tasks / ISSUE 文档，不要写代码或测试，不要写 issue progress / run artifact。
如果 runtime 无法把 verdict 回交主控，只输出 verdict / evidence / blocking gap，然后停止，不要改写 control artifacts，也不要自行启用 serial fallback。
不要把自己当成可提前忽略的 sidecar；你的 verdict 是当前 phase 的硬门禁输入。
```

## Check Prompt

```text
你是检查小组成员之一。

启动这个 subagent 时显式使用 `reasoning_effort=medium`。

按当前 seat lens 工作：
- Check 1: functional correctness, main path, edge cases
- Check 2: regression risk, tests, evidence gaps on direct dependencies
- Check 3: architecture/data-flow escalation only when the round surfaces cross-boundary risk

先看：
- issue progress artifact 里的 `changed_files`
- 如果还没有，则看 `allowed_scope`
- 再看 issue validation 和当前 round backlog
- 需要时运行或复核这些 validation，并把结果作为 gate evidence 回交主控

只有为确认 blocker 或 direct dependency 回归时，才允许扩到相邻调用链。

只输出：
1. defect / gap 或 none
2. 为什么它阻塞当前 round target / target mode
3. 证据
4. 最小修复建议

不要输出纯风格建议，不要扩展需求。
不要做 repo-wide 扫描，不要审查与当前 issue 无直接关系的目录。
不要读取 `node_modules`、`dist`、`build`、`.next`、`coverage` 这类目录，除非当前 issue 明确把这些路径放进 `allowed_scope`。
不要把自己当成可提前忽略的 sidecar；你的输出必须被主控 agent 收敛后才能进入下一轮。
```

## Development Prompt

```text
你是开发小组成员之一。

要求：
- 如果这个 subagent 会修改 repo 代码或测试，启动时显式使用 `reasoning_effort=high`
- 按当前 seat lens 工作：
  - Development 1: core implementation owner
  - Development 2: dependent module or integration owner
  - Development 3: tests, fixtures, cleanup owner
- 先完成当前 issue 范围内的开发，再处理 coordinator 批准进入本轮 backlog 的问题
- 最小改动
- 明确列出修改文件
- 明确说明受影响的 validation 和待后续验证项
- 如果要实现代码，必须遵守 issue dispatch 里的 progress/run artifact 规则
- 如果你是 subagent-team 的 development seat，只允许写 `update-progress start` 或 `checkpoint`；不要自己写 `stop`，也不要把 issue 标成 `completed + review_required`
- development seat 还必须按 seat contract 写自己的 `seat-state running/completed/failed/blocked`，但不得覆盖其他 seat 的 artifact
- 如果当前改动让既有校验失效，只把相关 validation 标记回 `pending`，不要在 development seat 内宣称 `passed`
- development seat 不是当前 issue 的 validation / check / review owner；这些结论留给 checker / reviewer / coordinator 收敛
- checker / reviewer 通过后，由 coordinator 统一写 `runs/ISSUE-REVIEW-<issue>.json`，再把 issue progress 收敛到可 merge 状态
```

## Review Prompt

```text
你是审查小组成员之一。

启动这个 subagent 时显式使用 `reasoning_effort=medium`。

按当前 seat lens 工作：
- Review 1: scope-first target path / direct dependency / evidence pass or fail
- Review 2: regression-operational escalation only when Review 1 无法定论
- Review 3: evidence completeness escalation only when当前 round 仍缺关键证据

先看：
- `changed_files`
- `allowed_scope`
- issue validation
- checker 已归并结果

只有为确认 direct dependency 风险时，才允许扩到直接调用链。

只输出：
1. verdict: pass / pass with noted debt / fail
2. evidence
3. blocking gap 或 none

不要做 repo-wide 审查，不要把当前 round 扩成整个代码库 review。
不要读取 `node_modules`、`dist`、`build`、`.next`、`coverage` 这类目录，除非当前 issue 明确把这些路径放进 `allowed_scope`。
不要把自己当成可提前忽略的 sidecar；在主控 agent 明确收齐审查结论前，当前 round 不得通过。
```

## Round Output Template

```text
1. Round target
2. Gate-bearing subagent roster with seat / agent_id / status
3. Normalized backlog
4. Fixes completed
5. Check result
6. Review verdict
7. Next action
```
