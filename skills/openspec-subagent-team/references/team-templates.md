# OpenSpec Subagent Team Templates

Use these templates after rendering `ISSUE-*.team.dispatch.md`.

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

## Check Prompt

```text
你是检查小组成员之一。

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
- 先完成当前 issue 范围内的开发，再处理 coordinator 批准进入本轮 backlog 的问题
- 最小改动
- 明确列出修改文件
- 明确说明验证方式
- 如果要实现代码，必须遵守 issue dispatch 里的 progress/run artifact 规则
```

## Review Prompt

```text
你是审查小组成员之一。

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
