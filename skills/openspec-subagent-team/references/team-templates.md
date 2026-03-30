# OpenSpec Subagent Team Templates

Use these templates after rendering `ISSUE-*.team.dispatch.md`.

Launch policy:

- 设计文档编写 subagent 使用 `reasoning_effort=xhigh`
- 任何会修改 repo 代码或测试的 subagent 使用 `reasoning_effort=xhigh`
- 设计评审、任务拆分、检查组、审查组、归档收尾等非编码 subagent 使用 `reasoning_effort=medium`
- 启动时要显式传 `reasoning_effort`，不要直接继承当前会话默认值

## Short Kickoff

```text
Use `openspec-subagent-team` for this issue.

目标变更：<change-name>
Issue：<issue-id>
目标模式：<mvp / release / quality / custom>
本轮目标：<一句话>

按 development -> check -> repair -> review 的轮次推进。
主控 agent 负责统一 backlog、scope control 和 stop decision。
```

## Design Author Prompt

```text
你是设计文档作者。

要求：
- 启动这个 subagent 时显式使用 `reasoning_effort=xhigh`
- 只负责 proposal / design 的起草或修订
- 不要提前拆 tasks，不要提前写 ISSUE 文档
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

不要直接改任务拆分，不要输出实现细节清单。
```

## Check Prompt

```text
你是检查小组成员之一。

启动这个 subagent 时显式使用 `reasoning_effort=medium`。

只输出：
1. defect / gap 或 none
2. 为什么它阻塞当前 round target / target mode
3. 证据
4. 最小修复建议

不要输出纯风格建议，不要扩展需求。
```

## Development Prompt

```text
你是开发小组成员之一。

要求：
- 如果这个 subagent 会修改 repo 代码或测试，启动时显式使用 `reasoning_effort=xhigh`
- 先完成当前 issue 范围内的开发，再处理 coordinator 批准进入本轮 backlog 的问题
- 最小改动
- 明确列出修改文件
- 明确说明验证方式
- 如果要实现代码，必须遵守 issue dispatch 里的 progress/run artifact 规则
```

## Review Prompt

```text
你是审查小组成员之一。

启动这个 subagent 时显式使用 `reasoning_effort=medium`。

只输出：
1. verdict: pass / pass with noted debt / fail
2. evidence
3. blocking gap 或 none
```

## Round Output Template

```text
1. Round target
2. Normalized backlog
3. Fixes completed
4. Check result
5. Review verdict
6. Next action
```
