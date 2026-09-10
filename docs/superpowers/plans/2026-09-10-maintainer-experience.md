# 维护者体验文档实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为仓库补齐贡献指南、GitHub 问题与安全模板、架构图、故障排查手册和 `0.1.0-rc.8 → 0.2.0` 迁移说明。

**架构：** 文档按维护者旅程拆分：README 提供入口，贡献与模板处理协作，架构与排障解释运行时，迁移说明覆盖升级和回滚。所有内容只描述当前已实现 API 和脚本。

**技术栈：** Markdown、GitHub Issue Template、Mermaid、PowerShell/PNPM 验证命令。

---

### 任务 1：增加贡献与 GitHub 模板

**文件：**
- 创建：`CONTRIBUTING.md`
- 创建：`.github/ISSUE_TEMPLATE/bug_report.md`
- 创建：`.github/ISSUE_TEMPLATE/feature_request.md`
- 创建：`.github/ISSUE_TEMPLATE/security_vulnerability.md`
- 创建：`SECURITY.md`

- [x] **步骤 1：编写贡献指南**

记录 Node.js/PNPM 要求、安装、`pnpm run verify:core`、`pnpm run verify`、Windows junction 测试注意事项、分支/提交/PR 要求和日志脱敏规则。

- [x] **步骤 2：编写问题和安全模板**

Bug 模板要求最小复现、环境和脱敏输出；功能模板要求问题、方案、兼容性和验收标准；安全模板只引导私下报告；`SECURITY.md` 说明当前支持版本与报告流程。

- [x] **步骤 3：检查模板可用性**

确认模板引用的命令、文件和配置字段存在，安全模板不要求用户公开凭据、真实 vault 路径或漏洞利用细节。

### 任务 2：增加架构与故障排查文档

**文件：**
- 创建：`docs/architecture.md`
- 创建：`docs/troubleshooting.md`

- [x] **步骤 1：编写 Mermaid 架构图**

描述 `ctx.effect` → 工具/提示词/审批/runner，runner → Agent/session/timer，工具 → vault/Git，日志与通知 → 宿主的关系，并说明多 vault 隔离。

- [x] **步骤 2：编写故障排查手册**

覆盖插件加载、vault/reportDir、权限、审批拒绝或超时、日报已存在、Agent/session 恢复、Git diff、路径安全和诊断字段缺失等场景；每项提供检查命令、原因和安全处置。

- [x] **步骤 3：检查排障内容**

逐项对照 `src/index.ts`、`src/tools.ts`、`src/runner.ts`、`src/fs.ts`、`src/git.ts` 的当前错误和状态名称，删除未实现的假设。

### 任务 3：增加版本迁移说明并接入 README

**文件：**
- 创建：`docs/migration-0.1.0-rc.8-to-0.2.0.md`
- 修改：`README.md`
- 修改：`README.zh.md`

- [x] **步骤 1：编写迁移说明**

包含升级前备份、配置字段核对、`writePolicy: ask`、报告独占写入、路径安全、运行状态与诊断验证、测试命令和回滚步骤；未实现的未来功能必须明确标注。

- [x] **步骤 2：增加维护者文档入口**

在中英文 README 的文档或维护者章节增加相对链接，避免破坏现有快速开始内容。

- [x] **步骤 3：执行文档验证**

运行链接/路径检查、Markdown 代码块检查、敏感信息扫描和 `git diff --check`，确认没有真实凭据、个人路径或未闭合代码块。
