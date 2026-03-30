# OpenSpec Issue Mode Template

已进入 OpenSpec Issue 模式。

说明：

- 简单任务通常不需要进入这里，直接在 OpenSpec 主链完成 proposal / design / tasks -> apply -> verify / archive 更合适
- 这里主要用于复杂任务，也就是需要拆 issue、跑 subagent-team、并按完整生命周期推进的 change

推荐方式：

1. 主会话先补齐 proposal / design / tasks，并做 change 级 implementation-ready review；如果 `auto_accept_spec_readiness=true`，这一关不需要人工签字
2. 把复杂实现拆成多个 issue，并对 issue 边界做一轮 review；如果 `auto_accept_issue_planning=true`，这一关不需要人工签字
3. 主会话维护 change 级 backlog / round report，不把门禁判断只留在聊天里
4. 主会话只为当前 round 已批准的 issue 创建或复用 worker worktree，并渲染 subagent-team lifecycle packet / `ISSUE-*.team.dispatch.md`
5. 默认用 subagent team 驱动开发 / 检查 / 修复 / 审查小组，作为整个 complex change 的协调入口
6. 只有在显式收窄到单个实现 worker 时，才让一个 issue 开一个 subagent，并且只在该 worktree 内工作
7. worker 只写 issue-local progress 和 run 工件，不直接合并、不直接提交
8. 主会话用 reconcile 收敛状态；如果 `auto_accept_issue_review=true` 且 issue-local validation 通过，主会话应直接自动 merge/commit 并继续下一轮
9. 所有 issue 都被主会话接受后，再做一轮 change 级 acceptance；如果 `auto_accept_change_acceptance=true`，这一关不需要人工签字，然后进入 verify / archive

如果你要的是“从进入 OpenSpec 模式开始”的复杂任务完整链路，直接复制下面这一套：

1. 进入 OpenSpec 模式

```text
进入 OpenSpec 模式。我接下来要做一个复杂变更，需要按完整生命周期推进。
```

2. 创建 change 并补齐 proposal / design / tasks

```text
帮我为这个需求创建 change，并补齐 proposal、design、tasks；完成后先不要直接开始实现。
```

3. 进入 issue-mode，并默认走 `subagent-team`

```text
按 issue 模式继续当前 change，默认入口使用 subagent-team，用多 agent 编排推进整个复杂变更生命周期。
```

4. 按全自动配置无人值守推进

```text
按当前 openspec/issue-mode.json 配置继续当前 change。
默认入口使用 subagent-team，按全自动方式推进整个生命周期。
对 subagent 使用 1 小时阻塞等待，不要 30 秒短轮询，直到 subagent 完成再返回。
```

5. 如果你想先看设计和任务拆分

```text
先按 issue 模式补齐 proposal、design、tasks 和 issue 规划。
暂时不要自动进入下一阶段，我要先看设计文档和任务拆分结果。
```

6. 如果中途返回过早，继续推进

```text
继续当前 change，保持 subagent-team 主链推进。
如果需要等待 subagent，使用 1 小时阻塞等待，直到 subagent 完成再返回。
```
