# `@ly028716/dsh-kb-daily`

[English](README.md) | 中文

独立发布的 DeepSeek Harness/Cordis 社区 bundle：扫描 Markdown 知识库，由专用 Agent 生成日报，写入 `<reportDir>/YYYY-MM-DD.md`。

## 兼容性

| 项目 | 值 |
| --- | --- |
| 包名 | `@ly028716/dsh-kb-daily` |
| GitHub 仓库 | `ly028716/dsh-kb-daily` |
| 已验证的 DSH CLI / bundle loader | `0.1.0-rc.8` |
| Node.js | `25.2.1` |
| pnpm | `11.7.0` |
| 核心验证命令 | `pnpm run verify:core` |

## 安装

使用 DSH 插件管理器把 bundle 安装并激活到目标 profile：

```sh
dsh plugin --profile <profile> add @ly028716/dsh-kb-daily
```

如果走 Git 安装，请固定 commit 或 tag：

```sh
dsh plugin --profile <profile> add github:ly028716/dsh-kb-daily#<commit-or-tag>
```

该包通过 `dsh.bundle.patch` 暴露 `cordis.patch.yml`，因此 `dsh plugin ... add <spec>` 会自动注入实际的 Cordis 插件入口。宿主组合必须提供已发布的 `agents`、`tools`、`systemPrompt` 和 `timer` 服务。Agent 的创建与恢复由宿主 Agent factory 提供。`sessionPersistence` 后端是可选的；没有持久化时，恢复会退化为创建新的 Agent。

```yaml
- name: '@ly028716/dsh-kb-daily'
  config:
    vaultPath: /absolute/path/to/vault
    reportDir: Daily
    timeZone: Asia/Shanghai
    agentId: kb-daily
    provider: deepseek
    model: deepseek-chat
    writePolicy: ask
    checkIntervalMs: 3600000
```

### 安全安装与最小权限配置

首次启用时，建议在隔离的 profile 中安装，并固定来源：

```sh
# 已审查的 npm 版本；不要在生产 profile 中无提示地跟随 latest。
dsh plugin --profile daily add @ly028716/dsh-kb-daily@<reviewed-version>

# 或固定到已审查的 Git commit（不要使用浮动分支名）。
dsh plugin --profile daily add github:ly028716/dsh-kb-daily#<full-commit-sha>
```

Git 安装会执行包的构建脚本。仅在核对仓库、commit 和 `package.json` 后，才在该 profile 使用的 `pnpm-workspace.yaml` 中批准构建：

```yaml
allowBuilds:
  '@ly028716/dsh-kb-daily': true
```

将配置写入 `$DSH_HOME/profiles/daily/cordis.patch.yml`，并遵循以下边界：

- `vaultPath` 必须是指向已授权知识库的绝对路径；插件拒绝把符号链接或 junction 作为 vault 根目录。
- 保持 `reportDir` 为 vault 内的子目录。读取、Git diff 和报告写入都会拒绝路径穿越与已存在的符号链接段。
- 先使用 `writePolicy: ask`。它会把 `kb_write_report` 交给宿主审批；没有审批通道时会拒绝写入。只有完成试运行并确认审批范围后，才考虑 `allow`。
- 不要把 API Key、访问令牌、个人绝对路径或真实笔记内容写入 patch、终端截图、Issue 或日志。模型会收到被读取笔记的内容，请只授权可发送给所选 provider 的 vault。
- 运行插件的账户应只拥有该 vault 所需的读取权限，以及 `reportDir` 的创建/写入权限；不要以管理员账户扫描整块磁盘或主目录。

可先按 [脱敏演示](docs/kb-daily-sanitized-demo.md) 使用合成 vault 验证审批与“同日报告不覆盖”行为，再接入真实知识库。

### 多 Vault（显式启用）

当一个 profile 需要管理多个相互独立的知识库时，使用 `vaults` 数组。每个条目必须提供稳定的 `id` 和明确的 `agentId`；插件会注册独立工具：`kb_<id>_list_modified`、`kb_<id>_read`、`kb_<id>_read_diff`、`kb_<id>_write_report`。

```yaml
- name: '@ly028716/dsh-kb-daily'
  config:
    vaults:
      - id: work
        vaultPath: /absolute/path/to/work-vault
        reportDir: Daily
        timeZone: Asia/Shanghai
        agentId: kb-daily-work
      - id: personal
        vaultPath: /absolute/path/to/personal-vault
        reportDir: Journal
        timeZone: Asia/Shanghai
        agentId: kb-daily-personal
```

Vault 的 `id` 和 `agentId` 必须唯一；Vault 路径不能相同、嵌套或重叠。旧的单 Vault 字段不能与 `vaults` 同时配置。每个条目拥有独立的 prompt section、工具、审批 listener、timer 和 runner 生命周期；多 Vault 是显式 opt-in，不会隐式扫描用户目录。

## 配置

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `vaultPath` | 旧模式必填 | Markdown 知识库的绝对路径。多 Vault 模式请改用显式的 `vaults` 数组。 |
| `reportDir` | `Daily` | 日报所在的、必须位于 vault 内的子目录。 |
| `timeZone` | 系统 IANA 时区 | 用于日期键和本地日扫描起点的时区。 |
| `agentId` | `kb-daily` | 专用 Agent 的稳定 session id。 |
| `provider` | 由部署解析 | 可选的 Agent provider 路由。 |
| `model` | 由部署解析 | 可选的 Agent model 路由。 |
| `writePolicy` | `ask` | `ask` 请求宿主审批；`allow` 允许本插件的写工具继续执行。 |
| `checkIntervalMs` | `3600000` | 跨日检查间隔。 |
| `maxFiles` | 不限 | 单次扫描最多纳入的文件数，必须是正整数。 |
| `maxTotalBytes` | 不限 | 单次扫描最多纳入的文件总字节数，必须是正整数。 |
| `maxFileBytes` | 不限 | 单文件纳入上限，超过的文件会被排除并标记为发生截断，必须是正整数。 |

## 运行行为

插件加载时以及每次 timer tick 都会检查今天的日报是否存在。若已存在，不会调度 Agent；若不存在，会优先恢复 `agentId`，持久化不可用时回退到 `agents.create()`，然后排队一个任务回合。in-flight 与“每天一次”守卫会阻止重复任务。runner 错误会被隔离，宿主 timer 仍可继续；同一天失败的尝试不会重试，直到插件重启或进入下一个本地日。

旧的单 Vault 模式注册四个模型工具：

- `kb_list_modified` 递归扫描 `vaultPath` 下的 Markdown 文件，跳过隐藏/维护目录，并以配置时区的本地午夜作为 cutoff。
- `kb_list_modified` 按稳定路径顺序返回文件，并附带 `truncated` 与 `totalBytes`。如果预算排除了文件，结果是不完整摘要；Agent 必须明确披露，不能让用户误认为覆盖了整个 vault。
- `kb_read` 读取 vault-relative 路径，最多返回 64 KiB 且不会截断 UTF-8 字符。越出 vault 的词法路径会被拒绝。
- `kb_read_diff` 是可选的 Git 增强，限制为 128 KiB；非 Git vault、无历史、二进制文件和超限 diff 都返回稳定的非致命错误。
- `kb_write_report` 根据当前配置时区的本地日期计算目标路径，不接受模型提供的输出路径。写入采用独占创建，因此不会覆盖已有日报。

多 Vault 模式下，每个 Vault 会在自己的 `kb_<id>_*` 命名空间下获得同样的四项能力；不同条目之间不共享可变 runner、工具注册、审批 listener、timer 或报告锁。

日报采用稳定的 YAML frontmatter（`date`、`timezone`、`source_count`、`generated_by`），随后是“今日概览”和“变更文件”章节。文件条目只使用 vault-relative 路径；无变更和预算截断都必须明确说明。

宿主提供 logger 时，runner 会发出 `kb-daily.started`、`kb-daily.skipped`、`kb-daily.created`、`kb-daily.failed` 和 `kb-daily.approval-required` 事件。事件只包含运行元数据；通知是可选的，仅在宿主提供 `notification.send` 适配器时发送。

`writePolicy: ask` 通过标准 DSH `tools/pre-execute` 返回 ask 决策，由宿主审批机制决定是否继续；如果没有审批通道，标准流水线会默认拒绝。插件不会写入源笔记，也不会绕过宿主工具策略。

所有 prompt section、tool、审批 listener、timer 和由 runner 创建的 Agent handle 都由 Cordis effect 归属插件。卸载插件会移除这些注册并释放 runner 创建的 Agent；重新加载会以相同配置的 session id 开启新的生命周期。

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run pack:inspect
pnpm run smoke:dsh
pnpm run verify:core
pnpm run verify
```

`verify:core` 是 CI 的阻塞门禁。`verify` 还会执行真实 DSH profile smoke test；在调查 DSH `0.1.0-rc.8` profile 初始化问题期间，GitHub Actions 中的 smoke 仅支持手动触发且不会阻塞主检查。

本包只使用已发布的 DeepSeek Harness 与 Cordis 公共 API。peer dependency 会镜像到开发依赖以支持本地类型检查和测试，不需要任何 `workspace:` 依赖。
