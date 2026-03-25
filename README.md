# OpenSpec Extensions

集中管理 OpenSpec issue-mode 扩展 skills 的仓库。

这些内容是对原生 OpenSpec 工作流的补充，目标是把复杂变更拆成 coordinator + worker 的多会话执行模式，并提供：

- 自然语言路由入口
- issue 拆分与派发
- 单 issue worker 执行约束
- worker 进度收敛
- worker 监控与恢复
- 共享配置与安装脚本

## Included Skills

- `openspec-chat-router`
- `openspec-plan-issues`
- `openspec-dispatch-issue`
- `openspec-execute-issue`
- `openspec-monitor-worker`
- `openspec-reconcile-change`
- `openspec-shared`

## Repository Layout

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
│   ├── openspec-monitor-worker/
│   ├── openspec-reconcile-change/
│   └── openspec-shared/
└── templates/
    └── issue-mode.json
```

## Install Into A Project

把本仓库的扩展 skills 安装到目标项目：

```bash
python3 scripts/install_openspec_extensions.py \
  --target-repo /path/to/your/project
```

仅预览安装结果：

```bash
python3 scripts/install_openspec_extensions.py \
  --target-repo /path/to/your/project \
  --dry-run
```

如果目标项目里已有同名 skills，需要显式覆盖：

```bash
python3 scripts/install_openspec_extensions.py \
  --target-repo /path/to/your/project \
  --force
```

如果需要覆盖目标项目现有的 `openspec/issue-mode.json`：

```bash
python3 scripts/install_openspec_extensions.py \
  --target-repo /path/to/your/project \
  --force-config
```

安装器会把内容写到：

- `.codex/skills/openspec-*`
- `.codex/skills/openspec-shared`
- `openspec/issue-mode.json`

并在需要时给目标项目 `.gitignore` 增加：

```text
.worktree/
```

## Config Template

`templates/issue-mode.json` 是目标项目的默认配置模板，对应安装后的 `openspec/issue-mode.json`。

当前支持的默认项包括：

- `worktree_root`
- `validation_commands`
- `codex_home`
- `persistent_host.kind`
- `worker_worktree.mode`
- `worker_worktree.base_ref`
- `worker_worktree.branch_prefix`

## Notes

- 这是扩展仓库，不包含原生 OpenSpec CLI 或原生 `openspec-apply-change` 等技能。
- 各 skill 内的相对引用按同级目录组织，安装后会落到目标项目 `.codex/skills/` 下继续工作。
- `openspec-shared` 里的脚本为其他扩展 skills 提供共享配置与安装逻辑。
