# OpenSpec Extensions

集中管理 OpenSpec `issue-mode` 扩展 skills 的仓库。

这个仓库的目标很明确：

- 用自然语言驱动 OpenSpec，而不是要求用户背 slash command
- 把复杂变更拆成 issue，并把 backlog / round / acceptance 放到磁盘
- 以 subagent 或 subagent-team 作为唯一推荐执行主链
- 由 coordinator 负责 reconcile、review、merge、commit、verify、archive

这里不再保留 detached worker、heartbeat、monitor-worker 这一套 fallback runtime。

## 仓库里有什么

```text
.
├── README.md
├── scripts/
│   └── install_openspec_extensions.py
├── skills/
│   ├── openspec-chat-router/
│   ├── openspec-plan-issues/
│   ├── openspec-dispatch-issue/
│   ├── openspec-execute-issue/
│   ├── openspec-reconcile-change/
│   ├── openspec-subagent-team/
│   └── openspec-shared/
└── templates/
    └── issue-mode.json
```

## Skill 说明

| Skill | 作用 |
| --- | --- |
| `openspec-chat-router` | 自然语言路由到正确的 OpenSpec 阶段 |
| `openspec-plan-issues` | 把已可实现的 change 拆成多个 issue，并生成 issue 文档 |
| `openspec-dispatch-issue` | 为某个 issue 生成 dispatch，并创建或复用 issue worktree |
| `openspec-execute-issue` | 在单个 issue worker context 中执行实现并写进度工件 |
| `openspec-reconcile-change` | 从 `issues/*.progress.json` 和 `runs/*.json` 收敛 coordinator 状态 |
| `openspec-subagent-team` | 用 subagent team 跑整个复杂变更生命周期的开发 / 检查 / 修复 / 审查回合 |
| `openspec-shared` | 提供共享脚本、配置逻辑和 verify 相关能力 |

## 默认执行模型

复杂任务的默认路径是：

1. 主会话把 change 补到 implementation-ready。
2. 主会话做 change 级 spec-readiness review。
3. 用 `plan-issues` 生成 `issues/INDEX.md` 和各个 `ISSUE-*.md`。
4. 主会话做 issue-planning review，确认边界、ownership、依赖和 acceptance。
5. 只为当前 round 已批准的 issue 创建或复用 worktree，并生成 dispatch / team dispatch。
6. 单个 issue 用一个 subagent；复杂 round 用 subagent team。
7. worker 只写 issue-local progress 和 run 工件，不自合并、不自提交。
8. 主会话用 `reconcile` 从磁盘工件收敛状态，并整理 change 级 backlog / round verdict。
9. 主会话 review、merge、commit。
10. 所有必要 issue 都 accept 后，再做 change 级 acceptance，然后进入 `verify` / `archive`。

## 为什么还保留 worktree

虽然 detached worker fallback 已经移除，但 `worker_worktree` 仍然保留，因为它现在承担的是 issue 隔离边界，而不是旧 runtime 的兼容层：

- dispatch 仍需要明确 issue 的执行根目录
- team dispatch 仍需要显式告诉 subagent 代码边界
- coordinator merge 仍从 issue worktree 收敛可接受改动

所以现在的关系是：

- 已删除：detached/background worker fallback
- 仍保留：issue worktree 隔离

## 配置契约

当前支持的 `openspec/issue-mode.json` 字段只有：

```json
{
  "worktree_root": ".worktree",
  "validation_commands": ["pnpm lint", "pnpm type-check"],
  "worker_worktree": {
    "mode": "detach",
    "base_ref": "HEAD",
    "branch_prefix": "opsx"
  },
  "rra": {
    "gate_mode": "advisory"
  },
  "subagent_team": {
    "auto_advance_after_design_review": false
  }
}
```

说明：

- `worktree_root`、`worker_worktree.*` 仍是 active 配置
- `validation_commands` 是 issue 默认校验命令
- `rra.gate_mode` 控制 advisory / enforce
- `subagent_team.auto_advance_after_design_review` 控制 design review 通过后是否自动进入 issue planning

旧的这些字段已经不再属于支持契约：

- `codex_home`
- `persistent_host`
- `coordinator_heartbeat`
- `worker_launcher`

如果旧仓库里还保留这些键，当前 helper 会忽略它们；建议逐步删掉。

## 安装到目标项目

```bash
python3 scripts/install_openspec_extensions.py \
  --target-repo /path/to/your/project
```

预览安装结果：

```bash
python3 scripts/install_openspec_extensions.py \
  --target-repo /path/to/your/project \
  --dry-run
```

覆盖已有同名 skills：

```bash
python3 scripts/install_openspec_extensions.py \
  --target-repo /path/to/your/project \
  --force
```

覆盖已有的 `openspec/issue-mode.json`：

```bash
python3 scripts/install_openspec_extensions.py \
  --target-repo /path/to/your/project \
  --force-config
```

安装器会写入：

- `.codex/skills/openspec-chat-router`
- `.codex/skills/openspec-plan-issues`
- `.codex/skills/openspec-dispatch-issue`
- `.codex/skills/openspec-execute-issue`
- `.codex/skills/openspec-reconcile-change`
- `.codex/skills/openspec-subagent-team`
- `.codex/skills/openspec-shared`
- `openspec/issue-mode.json`

并在需要时向目标项目 `.gitignore` 追加：

```text
.worktree/
openspec/changes/*/runs/CHANGE-VERIFY.json
```

## 当前收敛方向

现在这套扩展的方向是：

- 主链只有 coordinator + subagents
- 自动推进能力应继续收敛到 `subagent_team.*`
- worktree 只作为 issue 边界，不再承载 detached runtime 兼容

下一阶段如果继续简化，重点不再是删 fallback，而是判断：

1. 是否还要保留 issue worktree
2. coordinator merge 是否还能进一步去 worktree 化
3. `subagent_team` 还需要哪些生命周期开关
