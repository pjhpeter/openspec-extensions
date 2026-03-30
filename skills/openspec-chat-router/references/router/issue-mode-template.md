# OpenSpec Issue Mode Template

已进入 OpenSpec Issue 模式。

推荐方式：

1. 主会话先补齐 proposal / design / tasks，并做 change 级 implementation-ready review
2. 把复杂实现拆成多个 issue，并对 issue 边界做一轮 review
3. 主会话维护 change 级 backlog / round report，不把门禁判断只留在聊天里
4. 主会话只为当前 round 已批准的 issue 创建或复用 worker worktree，并渲染 `ISSUE-*.team.dispatch.md`
5. 显式需要 subagent team 时，优先用 team dispatch 驱动开发 / 检查 / 审查小组
6. 需要单个实现 worker 时，再让一个 issue 开一个 subagent，并且只在该 worktree 内工作
7. worker 只写 issue-local progress 和 run 工件，不直接合并、不直接提交
8. 主会话用 reconcile 收敛状态，输出 round target / normalized backlog / acceptance verdict，再决定 merge、repair 或下一轮 dispatch
9. 所有 issue 都被主会话接受后，再做一轮 change 级 acceptance，然后进入 verify / archive
