# OpenSpec Issue Mode Template

已进入 OpenSpec Issue 模式。
如果你想快速拿可复制提示词，也可以直接问我：常用的话术模版。

说明：

- 简单任务通常不需要进入这里，直接在 OpenSpec 主链完成 proposal / design / tasks -> apply -> review -> verify / archive 更合适
- 这里主要用于复杂任务，也就是需要拆 issue、跑 subagent-team、并按完整生命周期推进的 change

推荐方式：

1. 主会话先补齐 proposal / design，并做 change 级 design review；这里使用 1 个设计作者 subagent 和 2 个设计评审 subagent。设计作者使用 `reasoning_effort=high`，设计评审使用 `reasoning_effort=medium`。如果 `auto_accept_spec_readiness=true`，这一关不需要人工签字
2. design review 通过后，再把复杂实现拆成 `tasks.md` 和多个 issue，并对任务拆分边界做一轮 review；在开始首个 issue execution 前，主会话必须先把 `proposal.md`、`design.md`、`tasks.md`、`issues/INDEX.md`、`ISSUE-*.md` 提交成一次独立 commit。如果 `auto_accept_issue_planning=true`，这一关不需要人工签字，但仍要先提交这些文档，再立即派发首个已批准 issue，不要停在 `control-plane ready`
3. 主会话维护 change 级 backlog / round report，不把门禁判断只留在聊天里
4. 主会话只为当前 round 已批准的 issue 创建或复用 issue workspace（`worker_worktree`），并渲染 subagent-team lifecycle packet / `ISSUE-*.team.dispatch.md`。安装模板默认是每个 change 复用一个 `.worktree/<change>`，不是每个 issue 单独建一个 worktree
5. 默认用 subagent team 驱动开发 / 检查 / 修复 / 审查小组，作为整个 complex change 的协调入口；issue planning 默认走 `2 development + 1 check + 1 review`，issue execution 默认走 `3 development + 2 check + 1 review` 的快路径。任何编码 subagent 使用 `reasoning_effort=high`，其余规划/检查/审查 subagent 使用 `reasoning_effort=medium`
   - 如果当前 agent / runtime 不支持 subagent / delegation，就退回主会话串行 issue path：仍按同一份 lifecycle / team dispatch 执行，但由主会话自己完成 development / check / repair / review，一次只处理一个 approved issue
6. 主会话把当前 phase 里真正拉起的 design review / check / review seat 视为 gate-bearing subagent：
   - 记录 agent id、seat 和完成状态
   - 对它们使用最长 1 小时的阻塞等待，不要 30 秒短轮询
   - 在它们全部完成并收齐 verdict 前，不允许提前通过当前 phase，也不允许提前关闭这些 subagent
   - 不要把这些 gate-bearing subagent 当成 `explorer` sidecar
   - checker / reviewer 默认先看 `changed_files`，没有时先看 `allowed_scope` 和 issue validation；只有为确认 direct dependency 风险时才允许向外扩，不要默认做 repo-wide 扫描
   - 对前端项目，默认不要读取 `node_modules`、`dist`、`build`、`.next`、`coverage`，除非当前 issue 明确把这些路径放进 `allowed_scope`
   - lifecycle packet 只给主会话 coordinator；给各个 seat subagent 的应是 seat-local handoff，不要把整份 packet 原样塞给 design reviewer / author
   - 不要把完整 coordinator 线程 / 聊天历史 fork 给 design author / reviewer / planning / check / review seat；seat 只应拿到自己的 handoff 和必要文件引用
   - 一旦 seat subagent 已成功拉起，它就不能把“无 delegation 时主会话串行推进”的 fallback 套到自己头上，更不能自己继续到 issue planning / issue execution
   - 如果 gate-bearing seat 已经拉起，但结果回收链路不稳定，主会话只能重拉 seat 或停下处理 blocker；不要把该 gate 改成主会话自证通过，更不要直接继续后续 phase
7. 只有在显式收窄到单个 issue-only subagent 时，才让一个 issue 开一个 subagent，并且只在该 worktree 内工作
8. team dispatch 里的 development seat 只写代码和 progress checkpoint；如果代码改动让既有校验失效，只把对应 validation 标回 `pending`，不直接把 issue 标成 `completed + review_required`，也不在该 seat 内自称校验已通过。checker / reviewer 通过后，由主会话把结果写成 `runs/ISSUE-REVIEW-<issue>.json`
9. issue 执行回合不要求在每个 issue 上重复跑最终自动化测试；自动化测试/校验和自动化手工验证统一留到所有 issue 完成后的最终收口节点
10. issue 执行 subagent 不直接合并、不直接提交
11. 主会话用 reconcile 收敛状态；如果 `auto_accept_issue_review=true` 且 issue-local validation 通过，主会话应在 gate-bearing 审查 subagent 全部完成、`runs/ISSUE-REVIEW-<issue>.json` 已通过后直接自动 merge/commit 并继续下一轮。若当前 issue 使用的是 change 级 worktree，merge/commit 后还要把该 worktree 同步到最新接受 commit，再开始后续 issue
12. 所有 issue 都被主会话接受后，先确认自动化测试/校验与自动化手工验证证据齐全，再对当前 change 修改的代码运行一次 `/review`，把结果落成 `runs/CHANGE-REVIEW.json`
13. change-level `/review` 通过后，再做一轮 change 级 acceptance；如果 `auto_accept_change_acceptance=true`，这一关不需要人工签字，然后进入 verify / archive。对于 change 级 worktree，archive 时应一起清理对应 `.worktree/<change>`

所有 subagent 都要遵守下面这组角色铁律：

- 显式的 seat-local handoff 高于继承上下文；不要拿 coordinator 默认规则覆盖当前 seat 合同
- 只有主会话 coordinator 能维护 round/backlog、决定下一 phase、拉起或替换其他 seat、做 reconcile、merge、commit、verify、archive
- 已成功拉起的 seat 不得自升格成 coordinator，不得把“无法 delegation 时主会话串行推进”的 fallback 套到自己头上
- development seat 只负责实现、changed_files / pending-validation handoff 和 progress checkpoint；不负责拉 checker/reviewer，不负责 gate verdict，不负责宣布 issue 已过校验
- design / planning / check / review seat 只产出当前 phase 的结论和证据，不继续推进后续 phase
- 任一 seat 如果缺上下文、结果回传异常或 runtime 不稳定，应该报告 blocker 并停止，不要私自改 topology、补开 worker 或扩大 scope

如果你想先用最常用的三句话启动，直接复制下面这组：

1. 创建新需求

```text
你自己判断需求复杂度；如果属于复杂流程，自动启用 subagent-team 推进，不用再单独问我。
如需 spawned subagent，请显式使用 `<指定模型>`。
需求：<需求描述>
```

2. 继续现有需求

```text
继续 <change> change，根据原来判断的复杂度继续；如果是复杂流程，启用 subagent-team，spawned subagent 显式使用 `<指定模型>`。
```

3. 也可以直接问我：`常用的话术模版`

如果你要完整链路，再继续看下面：

1. 进入 OpenSpec 模式

```text
进入 OpenSpec 模式。我接下来要做一个复杂变更，需要按完整生命周期推进。
```

2. 创建 change 并补齐 proposal / design

```text
帮我为这个需求创建 change，并补齐 proposal、design；完成后先不要直接开始实现，也不要先拆任务。
```

3. 进入 issue-mode，并默认走 `subagent-team`

```text
按 issue 模式继续当前 change，默认入口使用 subagent-team，用多 agent 编排推进整个复杂变更生命周期。
```

4. 按全自动配置无人值守推进

```text
按当前 openspec/issue-mode.json 配置继续当前 change。
默认入口使用 subagent-team，按全自动方式推进到自动化测试收口。
设计文档编写 subagent 和编码 subagent 使用 high，其他 subagent 使用 Medium。
在所有 issues 完成后，先对当前 change 修改的代码执行 /review；review 通过后，再补齐自动化测试/校验和自动化手工验证证据；前端或其他浏览器可见改动必须优先使用 chrome devtools MCP 覆盖受影响主路径。然后再进入 verify。
对 subagent 使用 1 小时阻塞等待，不要 30 秒短轮询，直到 subagent 完成再返回。
当前 gate 的 review/check subagent 必须等待全部完成并收齐 verdict，禁止提前关闭或提前通过 phase。
```

5. 如果你想先看设计评审和任务拆分

```text
先按 issue 模式补齐 proposal、design，并完成设计评审。
设计评审通过后再做任务拆分；暂时不要自动进入下一阶段，我要先看设计文档和任务拆分结果。
```

6. 如果中途返回过早，继续推进

```text
继续当前 change，保持 subagent-team 主链推进。
如果需要等待 subagent，使用 1 小时阻塞等待，直到 subagent 完成再返回。
如果当前 phase 还有 review/check subagent 在运行，先等它们全部完成并收齐 verdict，再决定是否进入下一阶段。
如果 reconcile 的 next_action 是 `commit_planning_docs`，先提交规划文档，再重新 reconcile。
如果后续 next_action 是 `dispatch_next_issue`，不要停在 control-plane ready，立即渲染并派发下一 issue 的 team dispatch。
```
