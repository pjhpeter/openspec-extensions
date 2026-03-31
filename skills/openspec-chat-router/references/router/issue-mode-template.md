# OpenSpec Issue Mode Template

已进入 OpenSpec Issue 模式。

说明：

- 简单任务通常不需要进入这里，直接在 OpenSpec 主链完成 proposal / design / tasks -> apply -> review -> verify / archive 更合适
- 这里主要用于复杂任务，也就是需要拆 issue、跑 subagent-team、并按完整生命周期推进的 change

推荐方式：

1. 主会话先补齐 proposal / design，并做 change 级 design review；这里使用 1 个设计作者 subagent 和 2 个设计评审 subagent。设计作者使用 `reasoning_effort=xhigh`，设计评审使用 `reasoning_effort=medium`。如果 `auto_accept_spec_readiness=true`，这一关不需要人工签字
2. design review 通过后，再把复杂实现拆成 `tasks.md` 和多个 issue，并对任务拆分边界做一轮 review；如果 `auto_accept_issue_planning=true`，这一关不需要人工签字
3. 主会话维护 change 级 backlog / round report，不把门禁判断只留在聊天里
4. 主会话只为当前 round 已批准的 issue 创建或复用 issue worktree（`worker_worktree`），并渲染 subagent-team lifecycle packet / `ISSUE-*.team.dispatch.md`
5. 默认用 subagent team 驱动开发 / 检查 / 修复 / 审查小组，作为整个 complex change 的协调入口；issue planning 默认走 `2 development + 1 check + 1 review`，issue execution 默认走 `3 development + 2 check + 1 review` 的快路径。任何编码 subagent 使用 `reasoning_effort=xhigh`，其余规划/检查/审查 subagent 使用 `reasoning_effort=medium`
6. 主会话把当前 phase 里真正拉起的 design review / check / review seat 视为 gate-bearing subagent：
   - 记录 agent id、seat 和完成状态
   - 对它们使用最长 1 小时的阻塞等待，不要 30 秒短轮询
   - 在它们全部完成并收齐 verdict 前，不允许提前通过当前 phase，也不允许提前关闭这些 subagent
   - 不要把这些 gate-bearing subagent 当成 `explorer` sidecar
   - checker / reviewer 默认先看 `changed_files`，没有时先看 `allowed_scope` 和 issue validation；只有为确认 direct dependency 风险时才允许向外扩，不要默认做 repo-wide 扫描
   - 对前端项目，默认不要读取 `node_modules`、`dist`、`build`、`.next`、`coverage`，除非当前 issue 明确把这些路径放进 `allowed_scope`
7. 只有在显式收窄到单个 issue-only subagent 时，才让一个 issue 开一个 subagent，并且只在该 worktree 内工作
8. issue 执行 subagent 只写 issue-local progress 和 run 工件，不直接合并、不直接提交
9. 主会话用 reconcile 收敛状态；如果 `auto_accept_issue_review=true` 且 issue-local validation 通过，主会话应在 gate-bearing 审查 subagent 全部完成后直接自动 merge/commit 并继续下一轮
10. 所有 issue 都被主会话接受后，先对当前 change 修改的代码运行一次 `/review`，把结果落成 `runs/CHANGE-REVIEW.json`
11. change-level `/review` 通过后，再做一轮 change 级 acceptance；如果 `auto_accept_change_acceptance=true`，这一关不需要人工签字，然后进入 verify / archive

如果你要的是“从进入 OpenSpec 模式开始”的复杂任务完整链路，直接复制下面这一套：

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
默认入口使用 subagent-team，按全自动方式推进整个生命周期。
设计文档编写 subagent 和编码 subagent 使用 xhigh，其他 subagent 使用 Medium。
在所有 issues 完成后，先对当前 change 修改的代码执行 /review，通过后再进入 verify。
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
```
