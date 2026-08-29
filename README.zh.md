# `@ly028716/dsh-kb-daily`

[English](README.md) | 中文

独立发布的 DeepSeek Harness/Cordis 社区 bundle：扫描 Markdown 知识库，由专用 Agent 生成日报，写入 `<reportDir>/YYYY-MM-DD.md`。

## 兼容性

| 项目 | 值 |
| --- | --- |
| 包名 | `@ly028716/dsh-kb-daily` |
| GitHub 仓库 | `ly028716/dsh-kb-daily` |
| DSH release train | `0.1.0-rc.7` |
| Node.js | `22.x` |
| pnpm | `11.7.0` |
| 验证命令 | ``.\node_modules\.bin\vitest.cmd run tests/package.spec.ts && pnpm run typecheck && pnpm run build && pnpm pack --dry-run`` |

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

## 配置

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `vaultPath` | 必填 | Markdown 知识库的绝对路径。缺失、不可读或不是目录时插件加载失败。 |
| `reportDir` | `Daily` | 日报所在的、必须位于 vault 内的子目录。 |
| `timeZone` | 系统 IANA 时区 | 用于日期键和本地日扫描起点的时区。 |
| `agentId` | `kb-daily` | 专用 Agent 的稳定 session id。 |
| `provider` | 由部署解析 | 可选的 Agent provider 路由。 |
| `model` | 由部署解析 | 可选的 Agent model 路由。 |
| `writePolicy` | `ask` | `ask` 请求宿主审批；`allow` 允许本插件的写工具继续执行。 |
| `checkIntervalMs` | `3600000` | 跨日检查间隔。 |

## 运行行为

插件加载时以及每次 timer tick 都会检查今天的日报是否存在。若已存在，不会调度 Agent；若不存在，会优先恢复 `agentId`，持久化不可用时回退到 `agents.create()`，然后排队一个任务回合。in-flight 与“每天一次”守卫会阻止重复任务。runner 错误会被隔离，宿主 timer 仍可继续；同一天失败的尝试不会重试，直到插件重启或进入下一个本地日。

插件注册三个模型工具：

- `kb_list_modified` 递归扫描 `vaultPath` 下的 Markdown 文件，跳过隐藏/维护目录，并以配置时区的本地午夜作为 cutoff。
- `kb_read` 读取 vault-relative 路径，最多返回 64 KiB 且不会截断 UTF-8 字符。越出 vault 的词法路径会被拒绝。
- `kb_write_report` 根据当前配置时区的本地日期计算目标路径，不接受模型提供的输出路径。写入采用独占创建，因此不会覆盖已有日报。

`writePolicy: ask` 通过标准 DSH `tools/pre-execute` 返回 ask 决策，由宿主审批机制决定是否继续；如果没有审批通道，标准流水线会默认拒绝。插件不会写入源笔记，也不会绕过宿主工具策略。

所有 prompt section、tool、审批 listener、timer 和由 runner 创建的 Agent handle 都由 Cordis effect 归属插件。卸载插件会移除这些注册并释放 runner 创建的 Agent；重新加载会以相同配置的 session id 开启新的生命周期。

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
pnpm pack --dry-run
```

本包只使用已发布的 DeepSeek Harness 与 Cordis 公共 API。peer dependency 会镜像到开发依赖以支持本地类型检查和测试，不需要任何 `workspace:` 依赖。
