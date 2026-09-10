# 贡献指南

感谢参与 `@ly028716/dsh-kb-daily`。这是一个运行在 DeepSeek Harness / Cordis 中的本地知识库日报插件，变更必须同时考虑文件安全、Agent 生命周期、宿主审批和可观测性。

## 开发环境

- Node.js `25.2.1`（或仓库 CI 明确支持的版本）。
- pnpm `11.7.0`。
- Git。
- Windows 开发者模式或创建 junction 所需的权限；没有这些权限时，相关安全测试必须记录为环境限制，不要删除测试。

```sh
pnpm install
```

## 提交前验证

日常修改至少运行：

```sh
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run pack:inspect
git diff --check
```

涉及插件加载、Agent、审批、文件安全或发布产物时，运行完整门禁：

```sh
pnpm run verify:core
pnpm run verify
```

`verify` 可能访问本地 DSH profile。测试 vault 应使用临时目录和合成内容，不要把真实笔记、凭据或个人路径写入测试输出。

## 代码和测试约定

- 新功能或 Bug 修复先写一个能失败的行为测试，再修改生产代码。
- 文件路径必须经过 vault containment 和符号链接/junction 检查；不要用字符串拼接绕过现有文件系统边界。
- 报告写入必须保持独占创建，不能覆盖已有日报。
- 工具错误返回稳定错误码；日志和诊断只能记录计数、耗时、工具名称和脱敏原因，不记录笔记正文或报告正文。
- 运行器状态、审批状态和停止逻辑必须覆盖重复触发、跨日、卸载和 Agent 会话恢复场景。
- Windows 专属测试用例必须用平台条件保护，并在 Windows 上实际执行。

## 分支、提交与 Pull Request

1. 从最新默认分支创建短生命周期分支，例如 `codex/<topic>`。
2. 每个提交只解决一个主题；提交标题使用 `<type>(<scope>): <summary>`，例如 `fix(fs): reject report symlink race`。
3. Pull Request 描述问题、方案、兼容性影响和验证命令；如果修改安全边界，列出拒绝和降级场景。
4. 不要在 PR、Issue、日志或截图中提交 API key、访问令牌、真实 vault 路径、真实笔记内容或未公开漏洞细节。
5. 所有 CI 检查通过后再请求 review；安全问题使用私下报告流程。

## 文档与发布

维护者文档入口见 [架构说明](docs/architecture.md)、[故障排查手册](docs/troubleshooting.md) 和 [版本迁移说明](docs/migration-0.1.0-rc.8-to-0.2.0.md)。发布前还要核对 `package.json`、`CHANGELOG.md`、构建产物和 `cordis.patch.yml`。
