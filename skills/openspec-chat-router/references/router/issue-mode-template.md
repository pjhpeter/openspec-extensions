# OpenSpec Issue Mode Template

已进入 OpenSpec Issue 模式。

推荐方式：

1. 主会话先补齐 proposal / design / tasks
2. 把复杂实现拆成多个 issue
3. 主会话先为 issue 创建或复用对应的 worker worktree
4. 优先一个 issue 开一个 subagent，并且只在该 worktree 内工作
5. 只有需要后台脱机继续跑时，才改用外部 worker 会话或 heartbeat
6. worker 只写 issue-local progress 和 run 工件，不直接合并、不直接提交
7. 主会话用 reconcile 收敛状态，review 通过后合并该 worktree，并在主会话提交代码
8. 之后再统一维护 tasks.md、verify、archive

主会话话术模板：

- 继续 OpenSpec change `<change-name>`，先把文档补齐到可实现状态
- 把 `<change-name>` 拆成可并行的 issue，并给出每个 issue 的边界和验收标准
- 为 `<change-name>` 生成 `issues/INDEX.md` 和每个 issue 文档
- 为 `<issue-id>` 生成下一轮 worker dispatch 模板
- 为 `<issue-id>` 准备 dispatch，并直接开一个 subagent 执行
- 收敛 `<change-name>` 当前所有 worker 的 issue 状态，并决定下一步
- 现在验证 `<change-name>` 是否可以归档

Subagent / Worker 模板：

继续 OpenSpec change `<change-name>`，执行单个 issue。

本会话只处理一个 issue：

- Issue: `<issue-id or summary>`
- Allowed scope:
  - `<path>`
- Out of scope:
  - `<path or concern>`
- Done when:
  - `<acceptance item>`

开始后先写：

- `openspec/changes/<change-name>/issues/<issue-id>.progress.json`
- `openspec/changes/<change-name>/runs/RUN-<timestamp>-<issue-id>.json`

完成后更新同一组工件，再按下面格式回报：

- Issue: `<issue-id>`
- Files: `<paths>`
- Validation: `<commands/result>`
- Progress Artifact: `openspec/changes/<change-name>/issues/<issue-id>.progress.json`
- Run Artifact: `openspec/changes/<change-name>/runs/RUN-<timestamp>-<issue-id>.json`
- Need Coordinator Update: `yes/no`
