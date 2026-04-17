# OpenSpec Mode Cheat Sheet

已进入 OpenSpec 模式。
你也可以直接问我：常用的话术模版。

注意：

- 当前会话首次触发任一 `openspec-extensions` skill 时，应先做一次非阻塞版本检查；如果发现 npm 有更新版本，只提醒，不中断当前流程
- issue-mode 的默认 coordinator 入口是 `subagent-team`
- 如果用户没有明确指定 stage，就先做显式复杂度 triage；不要因为“看起来我自己能直接做完”而跳过这个闸门
- `2-3` 分是边界态，不是开始实现的授权；默认先走 `new` / `ff` 补 proposal/design，再重判
- 如果当前 change 已经有 `issues/*.progress.json`、`issues/*.team.dispatch.md`、`runs/ISSUE-PLANNING.json` 或 `control/ACTIVE-SEAT-DISPATCH.json`，这些磁盘工件比“开始做 / 开始实现 / 直接落地”这类聊天话术优先级更高；默认先 reconcile，再继续 `subagent-team` 主链
- 如果 triage 已选中复杂流，且你已授权“复杂时自动启用 subagent-team”，第一条执行更新就应明确说出：`路由决议：复杂流。我将按 subagent-team 协调推进；当前只允许补 proposal/design 并推进 spec_readiness，禁止开始实现。`
- 当你已经选定具体 change 且刚做完复杂度判断时，最好把结果写进 `openspec/changes/<change>/control/ROUTE-DECISION.json`，至少包含 `route`、`score`、`summary`、`rationale`、`recommended_flow`、`updated_at`
- 如果 `openspec/issue-mode.json` 里启用了 `subagent_team.auto_accept_*`，对应 gate 会由 coordinator 自动接受并继续，不再等待人工评审确认
- `auto_accept_*` 的真实含义是“收齐当前 gate 所需 subagent verdict 之后，跳过人工签字继续推进”，不是“子代理刚启动就可以直接进入下一阶段”
- 但某些 runtime 对真实拉起 subagent / delegation 仍要求你在当前会话里显式授权
- 对长时间 subagent 任务，某些 runtime / session 还可能使用较短等待并提前返回；要真正无人值守，最好显式要求长阻塞等待，例如 1 小时
- 某些 runtime 还会让 spawned subagent 继承当前会话的全局 `reasoning_effort`；如果你希望非编码 subagent 不要都跑成 `high`，要在 spawn 时显式覆写
- 门禁型 design-review / check / review subagent 不应当被当成 `explorer` sidecar；它们必须等到全部完成并收齐 verdict 后，当前 phase 才能通过
- 如果当前 agent / runtime 根本不支持 subagent 或 delegation，不要卡在 `subagent-team` 名称上；直接退回主会话串行 issue path，一次只处理一个 approved issue，继续写 progress / run 工件，再由 coordinator reconcile / review / verify / archive
- 如果你希望当前会话一定走多 agent 编排，直接说：
  - `按 issue 模式继续，并启用 subagent-team`
  - `这个 change 用 subagent team 推进`
  - `启用多 agent 编排推进当前 change`
  - `长时间等待 subagent 完成，使用 1 小时阻塞等待，不要 30 秒短轮询`
  - `对当前 subagent team 使用长等待，直到 subagent 完成再返回`
  - `当前 gate 的 review/check subagent 必须等待全部完成并收齐 verdict，禁止提前关闭或提前通过 phase`

最常用的三句话：

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

完整链路案例：

### 简单任务短链路

1. 进入 OpenSpec 模式

```text
进入 OpenSpec 模式。我接下来要做一个简单任务，先按短链路推进，不要默认拆成多个 issue。
```

2. 创建 change 并补齐文档

```text
帮我为这个需求创建 change，并把 proposal、design、tasks 一次性补齐到可实现。
```

3. 直接实现

```text
开始实现当前 change；如果任务规模仍然简单，并且当前 change 还没有进入 issue-mode，就不要拆 issue。直接完成实现；收尾时先过 change-level /review，review 通过后必须补齐自动化测试/校验和自动化手工验证。
```

4. review / verify / archive 收尾

```text
先对当前 change 修改的代码执行 /review；review 通过后，必须补齐自动化测试/校验和自动化手工验证；如果是前端或其他浏览器可见改动，优先使用 chrome devtools MCP 跑通受影响主路径。然后再检查当前 change 是否可以归档；如果 verify 通过，就同步 spec 并归档。
```

### 复杂任务全生命周期链路

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
在所有 issues 完成后，先对当前 change 修改的代码执行 /review；review 通过后，必须补齐自动化测试/校验和自动化手工验证。前端或其他浏览器可见改动优先使用 chrome devtools MCP 跑通受影响主路径，然后再进入 verify。
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

如果当前 change 已经写出 issue-mode 工件，但你只是想接着往下做，也可以直接这样说：

```text
这个 change 已经在 issue-mode 里了。先按磁盘上的 issue/progress/dispatch 状态 reconcile，再继续 subagent-team 主链；不要因为“开始实现”这类泛化话术退回 apply。
```

你可以直接这样说：

- 帮我起一个变更，把文档一次性补齐
- 继续刚才那个 change
- 按 issue 模式继续当前复杂 change
- 这个 change 已经拆过 issue，现在继续推进
- 开始实现当前变更
- 检查一下当前变更能不能归档

对应命令：

| 话术模板 | 等价命令 | 含义 |
| --- | --- | --- |
| 帮我梳理一下这个需求 | /opsx:explore | 先进入探索/澄清 |
| 帮我起一个变更，把文档补齐 | /opsx:propose | 小任务一键生成 proposal/design/tasks |
| 先建个 change，我想先看模板 | /opsx:new | 只创建 change 并展示第一步模板 |
| 按 issue 模式继续当前复杂 change | issue-mode -> subagent-team | 进入复杂变更执行模式，并默认从 subagent-team 主链推进 |
| 这个 change 已经拆过 issue，现在继续推进 | reconcile -> subagent-team | 先以 issue/progress/dispatch 工件为准恢复状态，再继续复杂流主链 |
| 把当前 change 的文档补齐到可以开始做 | /opsx:ff | 一次性补到可实现状态 |
| 继续刚才那个 change | /opsx:continue | 创建下一个 artifact |
| 开始实现当前变更 | /opsx:apply | 仅在当前 change 还没有进入 issue-mode 时按 tasks 开始实现 |
| 检查一下当前变更能不能归档 | /opsx:verify | 做归档前校验 |
| 把这个 change 的 delta spec 同步到主 spec | /opsx:sync-specs | 同步主 spec |
| 这个变更做完了，帮我归档 | /opsx:archive | 收尾归档 |

如果这次非阻塞版本检查检测到新版本，把下面这条高亮提醒追加在整段输出最后，不要放在最上面：

`【更新提醒】检测到 openspec-extensions 有新版本。可先退出到命令行执行 \`npm update -g openspec-extensions\` 更新 openspec-extensions，再执行 \`openspec-ex install --target-repo /path/to/your/project --force --force-config\` 刷新当前仓库插件；当前流程继续，不受这条提醒影响。`
