# OpenSpec Seat Control Plane Baseline Design

## Document Control

- Status: Baseline draft
- Date: 2026-04-04
- Parent plan: `docs/seat-control-plane-implementation-plan.md`
- Audience: maintainer, implementers, skill authors
- Goal: define the first repository-safe seat control plane that fits the current `openspec-extensions` architecture and can be rolled out without breaking existing flows

## 1. Design Summary

`openspec-extensions` 已经明确采用 coordinator + disk artifacts 主链。当前缺口不是新的 runtime，而是一个能表达 gate-bearing seat 运行态的显式控制面。

基线方案采用三个原则：

1. 继续 artifact-first，不引入后台进程、registry 或 heartbeat。
2. 不把多个 seat 的生命周期状态塞进一个共享 JSON，避免并发覆盖。
3. 不再把“当前 seat barrier”绑定到最新 `ROUND-*.md`，而是绑定到 coordinator 本轮显式生成的 `dispatch_id`。

本方案的目标是先补齐可观测性和 barrier 基础设施，再渐进接入 `reconcile`。

## 2. Goals

### Functional Goals

- coordinator 能看到当前 active dispatch 下 required gate-bearing seat 的真实状态
- `reconcile change` 能在推进 phase 前做 seat barrier 判断
- seat failure 要有结构化分类，不能只靠自由文本 summary
- seat lifecycle artifact 不替代 gate artifact、issue progress 或 round doc
- 无 seat artifact 时，现有工作流保持兼容

### Non-Goals

- 不实现 detached worker、daemon、heartbeat 或 runtime registry
- 不让 seat 直接决定 phase pass / fail
- 不把 seat lifecycle 回写进 `issues/*.progress.json` 或 `control/ROUND-*.md`
- 不要求第一版就重构 `reconcile.ts` 成规则表

## 3. Repository Constraints

这是基线方案必须尊重的现状：

- 当前复杂任务主链已经是 `dispatch lifecycle|issue-team` + `reconcile change` + `runs/*.json` + `issues/*.progress.json`
- `issue_execution` 仍然一次只处理一个 approved issue
- `ROUND-*.md` 是 round contract，不稳定等于 seat dispatch identity
- renderers 当前会覆盖固定文件名 packet，不会天然生成稳定可回收的 seat batch id
- 仓库里的 JSON 写入是普通 read-modify-write；如果多个 seat 并发写同一个文件，会有丢写风险

因此第一版不能采用“所有 seat 共同维护一个 `SEAT-STATE.json`”的方案。

## 4. Baseline Decisions

## 4.1 Identity Model

seat barrier 的 identity 使用 `dispatch_id`，不是 `round_id`。

原因：

- 最新 `ROUND-*.md` 可能仍然描述 planning scope，而当前 `issue-team` packet 已经回退到 issue-local contract
- 同一个 round 里可能重新渲染 packet，多次启动 seat
- `dispatch_id` 更接近当前仓库真正需要的语义：一次由 coordinator 明确发起、可恢复、可忽略旧记录的 seat batch

`dispatch_id` 规则：

- 由 coordinator 渲染 packet 时生成
- 同一 active dispatch 的所有 seat 共用同一个 `dispatch_id`
- 重新渲染新的 active dispatch 时生成新的 `dispatch_id`
- `reconcile` 只看 active dispatch 对应的 seat states

补充边界：

- 仅当 coordinator 明确启动“新的 seat batch”时才轮换 `dispatch_id`
- 同一 phase / 同一 issue / 同一 required seat 集合下，仅刷新 packet 文案、补写 manifest、或重跑不改变 batch 语义的渲染时，必须复用现有 `dispatch_id`
- 以下情况应生成新的 `dispatch_id`：
  - phase 变化
  - `issue_id` 变化
  - required seat 集合、seat role 或 gate-bearing/required 属性变化
  - coordinator 明确放弃当前 dispatch 并重新发起一轮 seat batch
- 旧 `dispatch_id` 对应的 seat-state 目录可保留用于审计，但不再参与当前 barrier 判断

## 4.2 Artifact Layout

基线 artifact 采用“两层结构”：

```text
openspec/changes/<change>/control/ACTIVE-SEAT-DISPATCH.json
openspec/changes/<change>/control/seat-state/<dispatch_id>/<seat_key>.json
```

职责边界：

- `ACTIVE-SEAT-DISPATCH.json`
  - coordinator-owned
  - 声明当前 active dispatch 是谁、有哪些 required seat、当前是否启用 barrier
- `seat-state/<dispatch_id>/<seat_key>.json`
  - seat-owned 或 coordinator-owned
  - 每个 seat 只写自己的文件
  - `reconcile` 读取目录并聚合，不要求 seat 共享写一个总表

这样可以避开共享 JSON 并发覆盖问题。

## 4.3 Active Dispatch Manifest

建议类型：

```ts
export type SeatPhase =
  | "spec_readiness"
  | "issue_planning"
  | "issue_execution"
  | "change_acceptance"
  | "change_verify"
  | "ready_for_archive";

export type SeatBarrierMode = "inactive" | "observe" | "enforce";

export interface ActiveSeatDefinition {
  seat: string;
  role: string;
  gate_bearing: boolean;
  required: boolean;
  reasoning_effort: "low" | "medium" | "high" | "unknown";
}

export interface ActiveSeatDispatchFile {
  schema_version: 1;
  change: string;
  dispatch_id: string;
  phase: SeatPhase;
  issue_id?: string;
  generated_at: string;
  barrier_mode: SeatBarrierMode;
  packet_path: string;
  seat_handoffs_path?: string;
  seats: ActiveSeatDefinition[];
}
```

关键点：

- `issue_id` 必须是可选字段；非 issue phase 不能伪造 issue id
- `barrier_mode` 允许分阶段 rollout
- manifest 是 reconcile 判断“当前 seat batch 是谁”的唯一入口

## 4.4 Seat State File

建议类型：

```ts
export type SeatLifecycleStatus =
  | "launching"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type SeatFailureKind =
  | "startup"
  | "handoff_contract"
  | "workspace"
  | "validation"
  | "review_gate"
  | "tool_runtime"
  | "timeout"
  | "unknown";

export interface SeatStateError {
  kind: SeatFailureKind;
  message: string;
}

export interface SeatStateRecord {
  schema_version: 1;
  change: string;
  dispatch_id: string;
  phase: SeatPhase;
  issue_id?: string;
  seat: string;
  seat_key: string;
  agent_id: string;
  gate_bearing: boolean;
  required: boolean;
  reasoning_effort: "low" | "medium" | "high" | "unknown";
  status: SeatLifecycleStatus;
  started_at: string;
  updated_at: string;
  completed_at?: string;
  last_checkpoint?: string;
  last_error?: SeatStateError;
}
```

设计约束：

- 一条 seat 只维护一个 seat file
- `seat_key` 由 CLI 统一 slugify，避免 seat 名称变化导致重复记录
- `completed_at` 只在 terminal 状态写入
- terminal 状态默认不允许 seat 自己反复改写；恢复只能由 coordinator 或人工工具完成
- `cancelled` 是 terminal 状态，但只允许 coordinator 或人工恢复工具写入；seat 自身应写 `completed`、`failed` 或 `blocked`
- `cancelled` 用于表达“当前 active dispatch 中该 seat 被显式终止或被新 dispatch 取代”，不是成功完成
- required + gate-bearing seat 若处于 `cancelled`，在 `enforce` 模式下按 terminal failure 处理，返回 `resolve_seat_failure`

## 4.5 Why Not a Shared `SEAT-STATE.json`

不采用单文件聚合的原因：

- 当前仓库没有锁或事务写入
- 多个 seat 并发写同一个 JSON 很容易互相覆盖
- 目录聚合更适合 `reconcile` 读多写少的模式
- 目录布局也更适合调试和人工恢复

## 5. Domain API

建议新建独立模块：

```text
src/domain/seat-control.ts
src/commands/execute/seat-state.ts
```

建议 helper：

```ts
export function activeSeatDispatchPath(repoRoot: string, change: string): string;
export function seatStateDir(repoRoot: string, change: string, dispatchId: string): string;
export function readActiveSeatDispatch(repoRoot: string, change: string): ActiveSeatDispatchFile | null;
export function writeActiveSeatDispatch(repoRoot: string, change: string, state: ActiveSeatDispatchFile): void;
export function seatStatePath(repoRoot: string, change: string, dispatchId: string, seatKey: string): string;
export function writeSeatState(repoRoot: string, record: SeatStateRecord): string;
export function readSeatStatesForDispatch(repoRoot: string, change: string, dispatchId: string): SeatStateRecord[];
export function summarizeSeatBarrier(
  manifest: ActiveSeatDispatchFile | null,
  seatStates: SeatStateRecord[]
): SeatBarrierSummary;
```

建议聚合结果：

```ts
export interface SeatBarrierSummary {
  active: boolean;
  blocking: boolean;
  mode: "inactive" | "observe" | "enforce";
  action: "" | "wait_for_gate_seats" | "resolve_seat_failure";
  dispatch_id: string;
  phase: string;
  issue_id?: string;
  required_missing: ActiveSeatDefinition[];
  required_running: SeatStateRecord[];
  required_failed: SeatStateRecord[];
  required_blocked: SeatStateRecord[];
  required_cancelled: SeatStateRecord[];
  required_completed: SeatStateRecord[];
}
```

## 6. CLI Surface

## 6.1 New Command

推荐新增独立命令：

```text
openspec-extensions execute seat-state set ...
```

不复用 `update-progress`，因为两者职责不同：

- `update-progress` 是 issue-local 执行进度
- `seat-state` 是 active dispatch barrier 控制面
- 基线只新增一个写入口，但要显式支持 coordinator/manual repair 对 terminal seat 的受控覆盖

## 6.2 Proposed Syntax

```bash
openspec-extensions execute seat-state set \
  --repo-root . \
  --change "<change>" \
  --dispatch-id "<dispatch-id>" \
  --phase issue_execution \
  --issue-id ISSUE-001 \
  --seat "Checker 1" \
  --status running \
  --agent-id "agent_abc123" \
  --gate-bearing true \
  --required true \
  --reasoning-effort medium \
  --checkpoint "validation_started"
```

失败时：

```bash
openspec-extensions execute seat-state set \
  --repo-root . \
  --change "<change>" \
  --dispatch-id "<dispatch-id>" \
  --phase issue_execution \
  --issue-id ISSUE-001 \
  --seat "Checker 1" \
  --status failed \
  --agent-id "agent_abc123" \
  --failure-kind validation \
  --failure-message "pnpm type-check failed in workspace"
```

恢复或重启同一 seat 时：

```bash
openspec-extensions execute seat-state set \
  --repo-root . \
  --change "<change>" \
  --dispatch-id "<dispatch-id>" \
  --phase issue_execution \
  --issue-id ISSUE-001 \
  --seat "Checker 1" \
  --status launching \
  --agent-id "agent_new123" \
  --allow-terminal-overwrite true
```

输出保持机器可读 JSON：

```json
{
  "seat_state_path": "openspec/changes/demo-change/control/seat-state/DISPATCH-20260404T141000/checker-1.json",
  "change": "demo-change",
  "dispatch_id": "DISPATCH-20260404T141000",
  "phase": "issue_execution",
  "issue_id": "ISSUE-001",
  "seat": "Checker 1",
  "status": "running"
}
```

命令约束：

- seat 正常回写不应使用 `--allow-terminal-overwrite`
- `--allow-terminal-overwrite` 只允许 coordinator 或人工恢复工具使用，用于纠正 stale terminal state、重启 seat 或把 seat 标记为 `cancelled`
- 若仓库实现允许，建议同时校验“当前文件已处于 terminal 状态”后再覆盖，避免误覆盖运行中的 seat

## 7. Renderer and Skill Contract

## 7.1 Renderer Output Changes

`issue-team-dispatch` 和 `lifecycle-dispatch` 需要新增：

- `dispatch_id`
- `active_seat_dispatch_path`
- `seat_state_dir`

并在 packet / seat handoff 中写清楚：

- coordinator 在真正 spawn gate-bearing seat 之前先写 `launching`
- seat 接手后写 `running`
- seat 结束后写 `completed`
- seat 因 runtime、workspace、validation 或 contract 问题无法继续时写 `failed` 或 `blocked`

注意：renderers 只负责发放 `dispatch_id` 和路径，不负责假装 seat 已经启动。

## 7.2 Skill Contract

需要同步更新：

- `skills/openspec-subagent-team/SKILL.md`
- `skills/openspec-subagent-team/references/team-templates.md`

新增硬规则：

- gate-bearing seat 只能写自己的 seat-state 文件
- coordinator 必须在 spawn 前写 `launching`
- `auto_accept_*` 仅在 required gate-bearing seat 全部完成后生效
- 如果 runtime 不支持稳定回收，seat 至少要回写 `failed` 或 `blocked`

## 8. Reconcile Integration

## 8.1 Baseline Ordering

`reconcile` 保持现有 gate / progress / review 主逻辑不变，只在推进 phase 前插入一层 seat barrier 聚合：

1. 读取 `ACTIVE-SEAT-DISPATCH.json`
2. 若 manifest 不存在，忽略 seat barrier
3. 若 `barrier_mode = inactive`，忽略 seat barrier
4. 若 manifest 存在，则读取对应 `dispatch_id` 目录下的 seat states
5. 只对 required + gate-bearing seat 做 barrier 判断
6. 之后再继续现有 issue progress / gate artifact / auto-accept 分支

## 8.2 Enforcement Rules

基线规则：

- `inactive`
  - seat barrier 完全不影响 `next_action`
- `observe`
  - 返回 `seat_barrier` summary，但不覆盖现有 `next_action`
- `enforce`
  - required seat 有 `launching` / `running` 时，返回 `wait_for_gate_seats`
  - required seat 有 `failed` / `blocked` / `cancelled` 时，返回 `resolve_seat_failure`
  - required seat 全部 `completed` 后，才允许继续现有 phase 推进逻辑

注意：

- “manifest 里定义了 seat，但还没有 `launching` 记录”默认不阻塞第一版 reconcile
- 这类 seat 必须在 summary 中进入 `required_missing`，用于暴露 coordinator 漏写或 skill 未升级
- 第一版只把“已显式纳入控制面”的 seat 作为 barrier 成员，避免 rollout 期间误阻塞

## 8.3 Reconcile Payload Additions

建议在 payload 顶层增加：

```ts
seat_barrier: {
  active: boolean;
  blocking: boolean;
  mode: string;
  action: string;
  dispatch_id: string;
  phase: string;
  issue_id?: string;
  required_missing: Array<{ seat: string; role: string }>;
  required_running: Array<{ seat: string; issue_id?: string; agent_id: string; status: string }>;
  required_failed: Array<{ seat: string; issue_id?: string; agent_id: string; status: string; failure_kind: string; failure_message: string }>;
  required_blocked: Array<{ seat: string; issue_id?: string; agent_id: string; status: string; failure_kind: string; failure_message: string }>;
  required_cancelled: Array<{ seat: string; issue_id?: string; agent_id: string; status: string }>;
}
```

## 9. Backward Compatibility

第一轮必须保证：

- 没有 `ACTIVE-SEAT-DISPATCH.json` 时，现有 `reconcile` 行为不变
- manifest 存在但 `barrier_mode != enforce` 时，不阻塞现有流程
- skill 还没升级时，coordinator 仍能走旧路径
- 旧 dispatch 的 seat-state 目录不影响当前 active dispatch

## 10. Rollout Plan

推荐按下面顺序上线：

1. 先发布 domain helper + `execute seat-state set`
2. 再让 renderers 产出 `dispatch_id`、manifest 路径和 seat-state 路径
3. 再更新 skill / handoff 模板，让 coordinator 和 seat 开始写 seat-state
4. 先以 `observe` 模式接入 `reconcile`
5. skill 升级稳定后，再把需要的 phase 切到 `enforce`

这比“先强制 barrier，再补 skill”更安全。

## 11. Test Matrix

### Unit Tests

`tests/unit/seat-control.test.ts`

- missing manifest / missing seat dir returns empty state
- `writeSeatState()` 正确生成 seat file 路径
- invalid failure kind is rejected
- terminal states set `completed_at`
- `cancelled` is terminal and coordinator-owned
- terminal overwrite requires explicit opt-in
- old `dispatch_id` does not affect active dispatch summary
- `summarizeSeatBarrier()` correctly separates missing / running / blocked / failed / cancelled / completed

### CLI Tests

`tests/cli/cli.test.ts`

- `execute seat-state set` routes correctly
- help text includes the new command

### Integration Tests

`tests/integration/seat-state.test.ts`

- command writes one seat file per seat
- repeated writes update the same seat file

`tests/integration/reconcile-seat-barrier.test.ts`

- no manifest -> existing reconcile behavior unchanged
- `observe` mode -> payload includes `seat_barrier` but `next_action` unchanged
- `enforce` + running required seat -> `wait_for_gate_seats`
- `enforce` + failed or cancelled required seat -> `resolve_seat_failure`
- required seat declared in manifest but unseen in seat-state -> exposed via `required_missing`, not blocked in baseline rollout
- completed seats + missing gate artifact -> still block on gate artifact
- completed seats + current gate artifact -> allow existing downstream branch

`tests/integration/issue-team-dispatch.test.ts`

- payload contains `dispatch_id`
- payload contains `active_seat_dispatch_path`
- packet text mentions seat-state update rule

`tests/integration/lifecycle-dispatch.test.ts`

- lifecycle packet surfaces active dispatch id and seat-state path
- lifecycle packet surfaces seat barrier summary when manifest exists

## 12. Recommendation

基线方案建议直接按下面顺序开工：

1. 新增 `src/domain/seat-control.ts`
2. 新增 `execute seat-state set`
3. 让 renderers 产出 `dispatch_id`、manifest 和 `seat_state_dir`
4. 更新 `openspec-subagent-team` skill 与 seat handoff 模板
5. 以 `observe` 模式接入 `reconcile`
6. 验证稳定后，再为特定 phase 切到 `enforce`

这条路径比原草案更贴合当前仓库，因为它解决了三个真实问题：

- 不再误把最新 `ROUND-*.md` 当成当前 seat batch identity
- 不再要求非 issue phase 伪造 `issue_id`
- 不再让多个 seat 并发写同一个共享 JSON
