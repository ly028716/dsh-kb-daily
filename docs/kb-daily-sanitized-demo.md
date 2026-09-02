# KB Daily 脱敏演示

本演示只使用合成 Markdown 文件，展示一次完整的「扫描 → 读取 → 审批 → 写入 → 二次跳过」流程。示例中的日期、路径和文本均为固定占位数据，不对应任何用户、项目或真实知识库。

## 演示前检查

- 在临时 profile 和临时 vault 中操作，不要复用日常 profile。
- `vaultPath` 使用绝对路径；录屏或截图时替换为 `<demo-vault>`，不要展示用户名或主目录。
- 不要设置或展示 provider 的 API Key、Cookie、审批令牌、会话 ID 或完整环境变量。
- 保持 `writePolicy: ask`，确认宿主显示审批请求后再允许写入。

## 合成配置

将以下配置写入临时 profile 的 `cordis.patch.yml`。`<demo-vault>` 仅表示本地临时目录：

```yaml
- name: '@ly028716/dsh-kb-daily'
  config:
    vaultPath: <demo-vault>
    reportDir: Daily
    timeZone: UTC
    agentId: kb-daily-demo
    writePolicy: ask
    checkIntervalMs: 3600000
```

临时 vault 只包含一份无敏感信息的笔记：

```text
<demo-vault>/
└── Notes/
    └── release-checklist.md
```

`Notes/release-checklist.md` 的示例内容：

```md
# Release checklist

- Run the test suite.
- Review the changelog.
```

## 脱敏回放

以下是可用于文档、截图或录屏的安全输出形状。不要复制真实路径、笔记正文或凭据。

```text
kb_list_modified({ since: "2026-09-02" })
→ {
    "files": [{ "path": "Notes/release-checklist.md", "size": 67, "mtime": 1788358000000 }],
    "truncated": false,
    "totalBytes": 67
  }

kb_read({ path: "Notes/release-checklist.md" })
→ {
    "content": "# Release checklist\n\n- Run the test suite.\n- Review the changelog.\n",
    "truncated": false
  }

kb_write_report({ content: "# Daily digest\n\n- Reviewed Notes/release-checklist.md" })
→ Host approval requested: write Daily/2026-09-02.md
→ Approved by the demo operator
→ { "path": "Daily/2026-09-02.md", "date": "2026-09-02", "created": true }
```

生成的报告仅包含 vault-relative 路径：

```md
# Daily digest

- Reviewed Notes/release-checklist.md
```

同一天再次触发时，runner 发现 `Daily/2026-09-02.md` 已存在并跳过调度；它不会再次调用 Agent，也不会覆盖该文件。

```text
kb-daily.skipped { "date": "2026-09-02", "status": "already-done" }
```

## 发布演示前的脱敏清单

- 替换所有绝对路径、用户名、机器名、provider 名称和 session 标识。
- 使用合成笔记；不要截取真实日报、客户资料、工作记录或 Git diff。
- 隐藏终端环境变量、浏览器标签页、审批 token 和通知内容。
- 检查报告中只出现 vault-relative 路径，且没有真实凭据或私有链接。
- 复现第二次调用的跳过行为，证明同日报告不会被覆盖。
