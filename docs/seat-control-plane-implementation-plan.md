# OpenSpec Seat Control Plane Baseline Implementation Plan

## Background

`openspec-extensions` 当前复杂任务主链已经是 artifact-first coordinator：

- `openspec/issue-mode.json` 提供 worktree、validation、gate mode 和 automation 配置
- `dispatch lifecycle` / `dispatch issue-team` 渲染 coordinator packet
- `issues/*.progress.json`、`runs/*.json`、`control/BACKLOG.md`、`control/ROUND-*.md` 持久化 issue、gate 和 round 状态
- `reconcile change` 基于这些工件决定 `next_action`

当前缺口不是“再做一个 runtime”，而是缺少一个能可靠表达 gate-bearing seat 生命周期的 artifact 层。

## Goal

落地一个适合当前仓库的 seat control plane 基线方案：

- 使用 `dispatch_id` 标识 active seat batch
- 用每-seat 独立文件记录 lifecycle，避免共享 JSON 并发覆盖
- 先以 observe 模式接入 `reconcile`
- 在 skill / handoff 契约稳定后，再为需要的 phase 启用 enforce barrier

## Non-Goals

- 不引入 daemon、registry、heartbeat
- 不替换 `progress.json`、`runs/*.json`、`ROUND-*.md`
- 不把 seat verdict 直接等同于 phase verdict
- 不在第一轮就重写整个 `reconcile.ts`

## Baseline Scope

## New Artifacts

```text
openspec/changes/<change>/control/ACTIVE-SEAT-DISPATCH.json
openspec/changes/<change>/control/seat-state/<dispatch_id>/<seat_key>.json
```

## New Code Paths

- `src/domain/seat-control.ts`
- `src/commands/execute/seat-state.ts`

## Existing Files To Update

- `src/cli/index.ts`
- `src/commands/reconcile.ts`
- `src/renderers/issue-team-dispatch.ts`
- `src/renderers/lifecycle-dispatch.ts`
- `skills/openspec-subagent-team/SKILL.md`
- `skills/openspec-subagent-team/references/team-templates.md`
- `tests/cli/cli.test.ts`
- `tests/integration/issue-team-dispatch.test.ts`
- `tests/integration/lifecycle-dispatch.test.ts`
- `tests/integration/reconcile-change.test.ts`

## Implementation Phases

## Phase 1: Seat Control Domain and CLI

目标：先把可写、可读、可聚合的控制面基础设施补齐，但不改变现有 `reconcile` 决策。

文件：

- `src/domain/seat-control.ts`
- `src/commands/execute/seat-state.ts`
- `src/cli/index.ts`
- `tests/unit/seat-control.test.ts`
- `tests/cli/cli.test.ts`
- `tests/integration/seat-state.test.ts`

工作：

- 定义 `ActiveSeatDispatchFile`、`SeatStateRecord`、`SeatBarrierSummary`
- 实现 `activeSeatDispatchPath()`、`seatStateDir()`、`seatStatePath()`、`readSeatStatesForDispatch()`、`summarizeSeatBarrier()`
- 实现 `execute seat-state set`
- 使用 `dispatch_id + seat_key` 定位单 seat 文件
- 校验 failure taxonomy、terminal 状态和时间戳写法
- 明确 `cancelled` 为 coordinator/manual-only terminal 状态
- 为 terminal state 恢复提供受控覆盖入口，例如 `--allow-terminal-overwrite`
- 在 barrier summary 中显式暴露 manifest 已声明但尚未写入 seat-state 的 `required_missing`

完成标准：

- seat-state CLI 可独立运行
- seat file 路径稳定
- 无 manifest / 无 seat dir 时读路径安全返回空结果

## Phase 2: Renderer Emits Active Dispatch Identity

目标：让 packet、payload 和 seat handoff 拥有稳定的 `dispatch_id` 与 artifact 路径。

文件：

- `src/renderers/issue-team-dispatch.ts`
- `src/renderers/lifecycle-dispatch.ts`
- `tests/integration/issue-team-dispatch.test.ts`
- `tests/integration/lifecycle-dispatch.test.ts`

工作：

- 渲染 packet 时生成 `dispatch_id`
- 输出 `active_seat_dispatch_path`
- 输出 `seat_state_dir`
- 渲染或刷新 `ACTIVE-SEAT-DISPATCH.json`
- 明确 `dispatch_id` 的复用/轮换规则：
  - phase、issue、required seat 集合不变时复用
  - 新 batch、seat 集合变化、issue 变化或显式放弃旧 dispatch 时轮换
- 在 packet / handoff 文案中写明：
  - coordinator spawn 前写 `launching`
  - seat 接手后写 `running`
  - seat 结束后写 `completed`
  - 无法继续时写 `failed` 或 `blocked`

完成标准：

- `issue-team-dispatch` payload 包含 `dispatch_id`
- `lifecycle-dispatch` payload 包含 active dispatch manifest 路径
- 新 packet 文案能指导 coordinator / seat 使用同一套 control-plane path

## Phase 3: Skill and Seat Handoff Contract

目标：让实际使用者开始按基线协议写 seat-state。

文件：

- `skills/openspec-subagent-team/SKILL.md`
- `skills/openspec-subagent-team/references/team-templates.md`

工作：

- coordinator 契约增加“spawn 前写 `launching`”
- seat 契约增加“接手写 `running`，结束写 `completed|failed|blocked`”
- 明确 gate-bearing seat 只能写自己的 seat-state 文件
- 明确 `auto_accept_*` 不能跳过 seat barrier

完成标准：

- skill 文案与 renderer 文案一致
- seat handoff 里能直接复制 seat-state 回写命令模板

## Phase 4: Reconcile Observe Mode

目标：先让 `reconcile` 看见 seat barrier，但不改变既有推进结果。

文件：

- `src/commands/reconcile.ts`
- `tests/integration/reconcile-seat-barrier.test.ts`
- `tests/integration/reconcile-change.test.ts`

工作：

- 读取 `ACTIVE-SEAT-DISPATCH.json`
- 读取 active `dispatch_id` 对应 seat-state 目录
- 计算 `seat_barrier` summary
- 将 manifest 声明但无 seat-state 记录的 required seat 暴露为 `required_missing`
- 当 `barrier_mode=observe` 时，把 summary 放进 payload，但不覆盖当前 `next_action`

完成标准：

- 旧仓库没有新 artifact 时，`reconcile` 行为不变
- observe 模式下 payload 有 `seat_barrier`，但下游动作不被误阻塞

## Phase 5: Reconcile Enforce Mode

目标：只对已经升级 skill / packet 的 active dispatch 启用真实 barrier。

文件：

- `src/commands/reconcile.ts`
- `tests/integration/reconcile-seat-barrier.test.ts`

工作：

- `barrier_mode=enforce` 时：
  - required running / launching -> `wait_for_gate_seats`
  - required failed / blocked / cancelled -> `resolve_seat_failure`
  - required completed -> 继续现有 gate / review / verify 分支
- 更新 `continuation_policy`

完成标准：

- 只有 active dispatch 被显式标记为 `enforce` 时才会阻塞流程
- 不会因为旧 seat-state 或未升级 skill 而误判
- `required_missing` 在基线 rollout 中可观测但默认不阻塞，避免把未升级 skill 直接判成失败

## Risks and Mitigations

## 1. Wrong Identity Source

风险：把 `ROUND-*.md` 当 seat batch identity，会把旧 round 或 planning round 错认成当前 seat barrier。

缓解：

- 基线只使用 `dispatch_id`
- `reconcile` 只看 `ACTIVE-SEAT-DISPATCH.json`

## 2. Concurrent File Writes

风险：多个 seat 同时更新一个共享 JSON，导致丢写。

缓解：

- 每个 seat 单独写一个文件
- `reconcile` 只做目录聚合

## 3. Skill / Renderer Drift

风险：CLI、renderer、skill 没同步升级，导致 packet 让人写 seat-state，但 `reconcile` 还没认，或反过来。

缓解：

- Phase 2 和 Phase 3 配套推进
- 先 observe，再 enforce

## 4. False Blocking During Rollout

风险：第一版就强制 barrier，会把未升级仓库卡死。

缓解：

- 基线引入 `barrier_mode`
- 默认先 observe
- 只有 active dispatch 显式切到 enforce 时才阻塞

## 5. Accidental Dispatch Rotation

风险：只是刷新 packet 或补写 manifest，却意外生成新的 `dispatch_id`，导致同一批 seat 被拆成多个 batch。

缓解：

- 明确 `dispatch_id` 只在“新 seat batch”语义下轮换
- 为复用与轮换分别补集成测试
- 让 `ACTIVE-SEAT-DISPATCH.json` 成为唯一 active identity 入口

## Validation Plan

代码落地后至少执行：

- `npm run lint`
- `npm run type-check`
- `npm test`

若本轮改动影响 CLI 路由、rendered packet、或 tarball 输出，还应补：

- `npm run build`
- `npm run smoke:package`

测试覆盖要求：

- `tests/unit`
  - seat-state 读写
  - failure taxonomy 校验
  - `cancelled` 与 terminal overwrite 约束
  - seat barrier 聚合
- `tests/cli`
  - `execute seat-state set` 路由
  - help text 更新
- `tests/integration`
  - renderer 输出 `dispatch_id`、manifest path、seat-state path
  - 同 batch rerender 复用 `dispatch_id`
  - 新 batch 条件下轮换 `dispatch_id`
  - observe mode 不改变既有 `next_action`
  - observe/enforce 都能暴露 `required_missing`
  - `cancelled` required seat 在 summary 中单独可见，并触发 `resolve_seat_failure`
  - enforce mode 正确返回 `wait_for_gate_seats` / `resolve_seat_failure`
  - completed seats 不替代 gate artifact freshness 判断

## Recommendation

建议把基线实现切成下面三段来交付：

1. Phase 1 + Phase 2
   - 先把数据模型、CLI、renderer 路径发出去
2. Phase 3 + Phase 4
   - 让 skill 和 `reconcile observe` 接上
3. Phase 5
   - 只在确认新契约稳定后再启用 enforce

这条路径比原草案更适合当前仓库，因为它保留了现有 artifact-first 主链，同时解决了原方案的三个实际问题：

- `round_id` 不再误绑到最新 `ROUND-*.md`
- 非 issue phase 不再被迫伪造 `issue_id`
- 多 seat 并发写不会互相覆盖
