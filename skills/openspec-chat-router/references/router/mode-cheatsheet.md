# OpenSpec Mode Cheat Sheet

已进入 OpenSpec 模式。

注意：

- issue-mode 的默认 coordinator 入口是 `subagent-team`
- 如果 `openspec/issue-mode.json` 里启用了 `subagent_team.auto_accept_*`，对应 gate 会由 coordinator 自动接受并继续，不再等待人工评审确认
- 但某些 runtime 对真实拉起 subagent / delegation 仍要求你在当前会话里显式授权
- 对长时间 subagent 任务，某些 runtime / session 还可能使用较短等待并提前返回；要真正无人值守，最好显式要求长阻塞等待，例如 1 小时
- 如果你希望当前会话一定走多 agent 编排，直接说：
  - `按 issue 模式继续，并启用 subagent-team`
  - `这个 change 用 subagent team 推进`
  - `启用多 agent 编排推进当前 change`
  - `长时间等待 subagent 完成，使用 1 小时阻塞等待，不要 30 秒短轮询`
  - `对当前 subagent team 使用长等待，直到 subagent 完成再返回`

你可以直接这样说：

- 帮我起一个变更，把文档一次性补齐
- 继续刚才那个 change
- 按 issue 模式继续当前复杂 change
- 开始实现当前变更
- 检查一下当前变更能不能归档

对应命令：

| 话术模板 | 等价命令 | 含义 |
| --- | --- | --- |
| 帮我梳理一下这个需求 | /opsx:explore | 先进入探索/澄清 |
| 帮我起一个变更，把文档补齐 | /opsx:propose | 小任务一键生成 proposal/design/tasks |
| 先建个 change，我想先看模板 | /opsx:new | 只创建 change 并展示第一步模板 |
| 按 issue 模式继续当前复杂 change | issue-mode -> subagent-team | 进入复杂变更执行模式，并默认从 subagent-team 主链推进 |
| 把当前 change 的文档补齐到可以开始做 | /opsx:ff | 一次性补到可实现状态 |
| 继续刚才那个 change | /opsx:continue | 创建下一个 artifact |
| 开始实现当前变更 | /opsx:apply | 按 tasks 开始实现 |
| 检查一下当前变更能不能归档 | /opsx:verify | 做归档前校验 |
| 把这个 change 的 delta spec 同步到主 spec | /opsx:sync-specs | 同步主 spec |
| 这个变更做完了，帮我归档 | /opsx:archive | 收尾归档 |
