# dsh-kb-daily 插件实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 DeepSeek Harness 中实现宿主侧插件 `@deepseek-ai/dsh-kb-daily`（`packages/examples/kb-daily`）：打开 dsh 时若今天的日报缺失则补跑，用专用 agent（`kb-daily`）扫描本地 Markdown 知识库并把日报写入 `Daily/YYYY-MM-DD.md`；每小时复查一次以覆盖跨天。

**架构：** 一个 Cordis 函数插件（`name`/`inject`/`apply`/`Config` 具名导出，无 default export），注册 3 个模型工具（`kb_list_modified`/`kb_read`/`kb_write_report`）与 1 个提示词区段；加载时用守卫检查日报文件，缺失则 `ctx.agents.resume`（失败回退 `ctx.agents.create`）专用 agent 并 `agent.followup()` 任务消息；`ctx.interval` 每小时复查。写报告工具经 `tools/pre-execute` 返回 `ask` 决策走 `ctx.approval` 审批（`writePolicy: allow` 时放行）。所有文件操作走 `node:fs/promises`，路径经包含性校验。

**技术栈：** TypeScript（ESM，`.ts` 相对导入）、Cordis（vendor）、`@deepseek-ai/schemastery`（Config）、vitest 4（`tests/*.spec.ts`）、`node:fs/promises`、`Intl.DateTimeFormat`。

**覆盖率门（必须满足）：** `docs/testing.md` 规定 `pnpm run test:coverage` 对 `packages/*/*/src` 每文件 100%——`packages/examples/*` 在内（`vitest.config.ts` include 第 166 行匹配）。因此每个 src 文件都要有把行/分支/函数补满的测试；`v8 ignore` 仅在有理由时使用（见 `vitest.config.ts` 第 269-272 行注释）。各任务的测试已含覆盖收尾用例，任务 14 步骤 4 跑全量覆盖率门。

**前置条件（执行前一次性完成）：**
```sh
cd E:\IDEWorkplaces\GitHub\deepseek-harness
pnpm install
# 若 packages/*/*/lib 缺失（全新 checkout）：pnpm run build
```
根 `package.json` 的 `version` 是权威版本号（当前 `0.1.0-rc.7`），每个新包 `version` 必须一致（由 `pnpm run constraints` 强制）。

**实现参考（必读，均为仓库内真实文件）：**
- 包样板：`packages/examples/agent-spine-demo/package.json`、`packages/examples/agent-spine-demo/tsconfig.json`、`packages/schedule/schedule/package.json`、`packages/schedule/schedule/tsconfig.json`
- 插件入口/Config 模式：`packages/examples/agent-spine-demo/src/index.ts`（`export interface Config` + `export const Config = z.object(...)` + `apply(ctx, config)`）
- 工具注册模式：`packages/schedule/schedule/src/tools.ts`（`ctx.tools.register(defineTool({...}))`、`output: { schema, render }`、`presentCall`）
- 组合测试模式：`packages/schedule/schedule/tests/plugin.spec.ts`（testkit + `ctx.tools.execute`）、`packages/examples/agent-spine-demo/tests/agent-core.spec.ts`（MockAdapter 驱动完整循环）
- 审批机制：`packages/core/tools/src/index.ts` 第 588-591 行（`PreToolDecision`）、`packages/interaction/user-approval/README.md`

---

## 文件结构

```
packages/examples/kb-daily/
  package.json            # release-member 样板（见任务 1）
  tsconfig.json           # extends ../../../tsconfig.base.json
  src/index.ts            # 插件入口：name/inject/Config/apply，装配各模块
  src/invariant.ts        # invariant 伴生模块（仓库对 packages/*/* 成员的强制义务，样板见 agent-spine-demo/src/invariant.ts）
  src/config.ts           # Config 接口 + Schemastery schema（也可并入 index.ts，计划并入 index.ts）
  src/date.ts             # dateKey(now, tz) / reportFileName(date) —— 纯函数
  src/paths.ts            # resolveReportPath / assertContained —— 纯函数（路径包含性）
  src/fs.ts               # listModifiedFiles / readVaultFile / writeReport / reportExists
  src/prompt.ts           # sectionText / taskFraming
  src/tools.ts            # registerTools：3 个 defineTool 注册
  src/approval.ts         # registerWriteApproval：tools/pre-execute ask 门
  src/runner.ts           # createGuard / runDailyCheck / startRunner
  tests/plugin.spec.ts    # 导出形状 + 组合 + 卸载回滚 + ask 门（经插件装配）
  tests/date.spec.ts      # dateKey / reportFileName
  tests/paths.spec.ts     # assertContained / resolveReportPath
  tests/fs.spec.ts        # listModifiedFiles / readVaultFile / writeReport / reportExists
  tests/prompt.spec.ts    # sectionText / taskFraming
  tests/tools.spec.ts     # 3 个工具经 ctx.tools.execute 的行为
  tests/runner.spec.ts    # createGuard 守卫 + runDailyCheck（MockAdapter 驱动）
  tests/run.spec.ts       # 端到端：插件加载 → 补跑 → agent 工具链 → 日报落盘
  README.md / README.zh.md / README.i18n.yaml   # 双语三件套（钩子强制）
examples/kb-daily/
  cordis.yml              # overlay：挂载 @deepseek-ai/dsh-kb-daily
  README.md / README.zh.md / README.i18n.yaml   # 双语三件套
修改：
  tsconfig.host.json      # references 增加 ./packages/examples/kb-daily
  examples/package.json   # dependencies 增加 @deepseek-ai/dsh-kb-daily（verify-cordis-config 强制）
```

---

## 任务 1：包脚手架

**文件：**
- 创建：`packages/examples/kb-daily/package.json`
- 创建：`packages/examples/kb-daily/tsconfig.json`
- 创建：`packages/examples/kb-daily/src/index.ts`（最小桩）
- 修改：`tsconfig.host.json`（references）

- [ ] **步骤 1：创建 package.json**

```json
{
  "name": "@deepseek-ai/dsh-kb-daily",
  "description": "Daily catch-up knowledge-base digest: a dedicated agent scans the vault and writes Daily/YYYY-MM-DD.md",
  "version": "0.1.0-rc.7",
  "publishConfig": {
    "access": "public"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deepseek-ai/deepseek-harness.git",
    "directory": "packages/examples/kb-daily"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./invariant": {
      "types": "./lib/types/invariant.d.ts",
      "default": "./lib/invariant.js"
    },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "files": [
    "lib/index.js",
    "lib/invariant.js",
    "lib/types/**/*.d.ts"
  ],
  "license": "MIT",
  "peerDependencies": {
    "@deepseek-ai/cordis": "workspace:^",
    "@deepseek-ai/cordis-plugin-timer": "workspace:^",
    "@deepseek-ai/dsh-agent": "workspace:^",
    "@deepseek-ai/dsh-invariants": "workspace:^",
    "@deepseek-ai/dsh-llm": "workspace:^",
    "@deepseek-ai/dsh-session": "workspace:^",
    "@deepseek-ai/dsh-system-prompt": "workspace:^",
    "@deepseek-ai/dsh-tools": "workspace:^"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "workspace:^",
    "@deepseek-ai/cordis-plugin-loader": "workspace:^",
    "@deepseek-ai/cordis-plugin-timer": "workspace:^",
    "@deepseek-ai/dsh-agent": "workspace:^",
    "@deepseek-ai/dsh-agent-loop": "workspace:^",
    "@deepseek-ai/dsh-agent-loop-testkit": "workspace:^",
    "@deepseek-ai/dsh-invariants": "workspace:^",
    "@deepseek-ai/dsh-llm": "workspace:^",
    "@deepseek-ai/dsh-session": "workspace:^",
    "@deepseek-ai/dsh-session-persistence-jsonl": "workspace:^",
    "@deepseek-ai/dsh-system-prompt": "workspace:^",
    "@deepseek-ai/dsh-tools": "workspace:^"
  },
  "dependencies": {
    "@deepseek-ai/schemastery": "workspace:^"
  }
}
```
注意：`version` 与根 `package.json` 一致；`@deepseek-ai/cordis` 同时在 peerDependencies 和 devDependencies 且版本一致（这两条由 `pnpm run constraints` 强制）；每个 dsh peer 依赖镜像到 devDependencies 属仓库惯例（照抄样板即可）。若 `dsh-agent-loop-testkit` 包名有出入，以 `packages/test-support/agent-loop-testkit/package.json` 的 `name` 为准。`inject` 声明了 `timer`，因此 `@deepseek-ai/cordis-plugin-timer` 必须同时出现在 peer 与 dev 依赖（任务 10 装配与测试会用到）。

- [ ] **步骤 2：创建 tsconfig.json**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib/types"
  },
  "include": [
    "src"
  ],
  "references": [
    { "path": "../../../vendor/cosmokit" },
    { "path": "../../../vendor/cordis" },
    { "path": "../../../vendor/schemastery" },
    { "path": "../../core/agent" },
    { "path": "../../core/session" },
    { "path": "../../core/system-prompt" },
    { "path": "../../core/tools" },
    { "path": "../../llm/llm" },
    { "path": "../../runtime-diagnostics/invariants" }
  ]
}
```

- [ ] **步骤 3：创建最小入口桩**

`packages/examples/kb-daily/src/index.ts`：

```ts
/**
 * Daily catch-up knowledge-base digest.
 * @module @deepseek-ai/dsh-kb-daily
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Cordis function-plugin name. */
export const name = 'kb-daily'
/** Services required before the plugin can run. */
export const inject = ['agents', 'tools', 'systemPrompt', 'timer']

export interface Config {
  /** Absolute path to the Markdown knowledge-base vault. */
  vaultPath: string
  /** Subdirectory under the vault that receives daily reports (default Daily). */
  reportDir?: string
  /** IANA time zone used for "today"; defaults to the system zone. */
  timeZone?: string
  /** Stable session id of the dedicated KB agent (default kb-daily). */
  agentId?: string
  /** Provider for the dedicated agent; omitted lets the deployment resolve it. */
  provider?: string
  /** Model for the dedicated agent. */
  model?: string
  /** Write approval for kb_write_report: ask (default) or allow. */
  writePolicy?: 'ask' | 'allow'
  /** Day-rollover re-check interval in ms (default 1 hour). */
  checkIntervalMs?: number
}

export const Config = z.object({
  vaultPath: z.string().required(),
  reportDir: z.string().default('Daily'),
  timeZone: z.string(),
  agentId: z.string().default('kb-daily'),
  provider: z.string(),
  model: z.string(),
  writePolicy: z.union([z.const('ask'), z.const('allow')]).default('ask'),
  checkIntervalMs: z.number().default(60 * 60 * 1000),
}) as unknown as z<Config>

/** Placeholder; wired up in task 10. */
export function apply(_ctx: Context, _config: Config): void {
  // no-op
}
```

### 步骤 3b：创建 invariant 伴生模块

`packages/examples/kb-daily/src/invariant.ts`（样板：`packages/examples/agent-spine-demo/src/invariant.ts`，含 `jscpd:ignore` 标记以满足重复代码门禁）：

```ts
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-kb-daily`.
 * @module @deepseek-ai/dsh-kb-daily/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-kb-daily'

/** Cordis companion plugin name. */
export const name = 'kb-daily-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this plugin owns no independent event stream or mutable data;
 * Loader and built-entry tests cover its wiring.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
```

- [ ] **步骤 4：注册到 host aggregate**

在 `tsconfig.host.json` 的 `references` 数组中（`packages/examples/*` 条目附近）增加：

```json
{ "path": "./packages/examples/kb-daily" }
```

- [ ] **步骤 5：安装并验证**

```sh
pnpm install
pnpm exec tsc -b packages/examples/kb-daily
pnpm run constraints
pnpm run verify-package-invariants
```
预期：`tsc -b` 退出码 0，无输出（若报缺少依赖的 `lib/types`，先跑一次 `pnpm run build`）；`constraints` 与 `verify-package-invariants` 退出码 0（两者是仓库对 `packages/*/*` 成员的强制门禁，分别核对 package.json 不变量与 invariant 伴生模块，见 `scripts/check-workspace-constraints.ts` 与 `scripts/package-invariants.ts`）。

- [ ] **步骤 6：Commit**

```sh
git add packages/examples/kb-daily tsconfig.host.json
git commit -m "chore: scaffold kb-daily example package"
```

---

## 任务 2：插件导出形状测试（Config 已就位）

**文件：**
- 创建：`packages/examples/kb-daily/tests/plugin.spec.ts`
- 修改：`packages/examples/kb-daily/src/index.ts`

- [ ] **步骤 1：编写失败的导出形状测试**

```ts
import { describe, expect, it } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as kbDaily from '../src/index.ts'

describe('kb-daily plugin export shape', () => {
  it('has the Loader-safe function-plugin export shape', () => {
    expect('default' in kbDaily).toBe(false)
    expect(kbDaily.name).toBe('kb-daily')
    expect(kbDaily.inject).toEqual(['agents', 'tools', 'systemPrompt', 'timer'])
    expect(kbDaily.Config).toBeDefined()
    expect(typeof kbDaily.apply).toBe('function')
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(kbDaily)).toBe(kbDaily)
  })
})
```

- [ ] **步骤 2：运行测试确认失败**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/plugin.spec.ts
```
预期：FAIL（`inject` 尚不存在 / `Config` 未定义）。

- [ ] **步骤 3：补齐入口导出**

`src/index.ts` 中 `apply` 之上已有 `name`/`inject`/`Config`——若测试仍失败，把 `inject` 改为上面声明的数组并确保 `export const Config` 存在（任务 1 的桩已包含，此时应转绿；若有遗漏按报错补齐）。

- [ ] **步骤 4：运行测试确认通过**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/plugin.spec.ts
```
预期：PASS。

- [ ] **步骤 5：Commit**

```sh
git add packages/examples/kb-daily/src/index.ts packages/examples/kb-daily/tests/plugin.spec.ts
git commit -m "test(kb-daily): assert Loader-safe plugin export shape"
```

---

## 任务 3：日期纯函数

**文件：**
- 创建：`packages/examples/kb-daily/src/date.ts`
- 创建：`packages/examples/kb-daily/tests/date.spec.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
import { describe, expect, it } from 'vitest'
import { dateKey, reportFileName } from '../src/date.ts'

describe('kb-daily date helpers', () => {
  it('formats a Date as YYYY-MM-DD in an explicit IANA zone', () => {
    const instant = new Date('2026-08-17T02:00:00Z')
    expect(dateKey(instant, 'UTC')).toBe('2026-08-17')
    expect(dateKey(instant, 'Asia/Shanghai')).toBe('2026-08-17')
    expect(dateKey(instant, 'America/Los_Angeles')).toBe('2026-08-16')
  })
  it('builds the report file name', () => {
    expect(reportFileName('2026-08-17')).toBe('2026-08-17.md')
  })
})
```

- [ ] **步骤 2：运行确认失败**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/date.spec.ts
```
预期：FAIL（模块不存在）。

- [ ] **步骤 3：实现**

```ts
/** Format a Date as YYYY-MM-DD in an explicit IANA time zone. */
export function dateKey(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const field = (type: string): string => parts.find(part => part.type === type)?.value ?? ''
  return `${field('year')}-${field('month')}-${field('day')}`
}

/** Report file name for a date key. */
export function reportFileName(date: string): string {
  return `${date}.md`
}
```

- [ ] **步骤 4：运行确认通过**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/date.spec.ts
```
预期：PASS。

- [ ] **步骤 5：Commit**

```sh
git add packages/examples/kb-daily/src/date.ts packages/examples/kb-daily/tests/date.spec.ts
git commit -m "feat(kb-daily): add time-zone date key helpers"
```

---

## 任务 4：路径包含性校验

**文件：**
- 创建：`packages/examples/kb-daily/src/paths.ts`
- 创建：`packages/examples/kb-daily/tests/paths.spec.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertContained, resolveReportPath } from '../src/paths.ts'

describe('kb-daily path containment', () => {
  it('resolves the report path under the vault', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      expect(resolveReportPath(root, 'Daily', '2026-08-17.md')).toBe(join(root, 'Daily', '2026-08-17.md'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('accepts nested contained paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      expect(assertContained(root, 'notes/a.md')).toBe(join(root, 'notes', 'a.md'))
      expect(assertContained(root, './notes/../notes/a.md')).toBe(join(root, 'notes', 'a.md'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('rejects paths that escape the vault', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      expect(() => assertContained(root, '../escape.md')).toThrow(/escapes the vault/)
      expect(() => assertContained(root, '/etc/passwd')).toThrow(/escapes the vault/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
```

- [ ] **步骤 2：运行确认失败**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/paths.spec.ts
```
预期：FAIL（模块不存在）。

- [ ] **步骤 3：实现**

```ts
import { isAbsolute, join, relative, resolve } from 'node:path'

/** Absolute report path: vault/reportDir/fileName. */
export function resolveReportPath(vaultPath: string, reportDir: string, fileName: string): string {
  return join(vaultPath, reportDir, fileName)
}

/** Resolve a vault-relative path; reject anything that escapes the vault. */
export function assertContained(vaultPath: string, relPath: string): string {
  const root = resolve(vaultPath)
  const candidate = resolve(root, relPath)
  const rel = relative(root, candidate)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`path escapes the vault: ${relPath}`)
  }
  return candidate
}
```

- [ ] **步骤 4：运行确认通过**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/paths.spec.ts
```
预期：PASS。

- [ ] **步骤 5：Commit**

```sh
git add packages/examples/kb-daily/src/paths.ts packages/examples/kb-daily/tests/paths.spec.ts
git commit -m "feat(kb-daily): add vault path containment checks"
```

---

## 任务 5：文件系统操作

**文件：**
- 创建：`packages/examples/kb-daily/src/fs.ts`
- 创建：`packages/examples/kb-daily/tests/fs.spec.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listModifiedFiles, readVaultFile, reportExists, writeReport } from '../src/fs.ts'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

async function fixtureVault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
  await mkdir(join(root, 'notes'), { recursive: true })
  const now = Date.now()
  await writeFile(join(root, 'notes', 'today.md'), '# today')
  await utimes(join(root, 'notes', 'today.md'), new Date(now), new Date(now))
  await writeFile(join(root, 'notes', 'old.md'), '# old')
  await utimes(join(root, 'notes', 'old.md'), new Date(now - 2 * DAY), new Date(now - 2 * DAY))
  await writeFile(join(root, 'ignored.txt'), 'not markdown')
  return root
}

describe('kb-daily fs operations', () => {
  it('lists only .md files modified since the cutoff, sorted, vault-relative', async () => {
    const root = await fixtureVault()
    try {
      const files = await listModifiedFiles(root, Date.now() - HOUR)
      expect(files).toEqual([{ path: 'notes/today.md', size: 7 }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('reads contained files and truncates over the cap', async () => {
    const root = await fixtureVault()
    try {
      expect(await readVaultFile(root, 'notes/today.md')).toEqual({ content: '# today', truncated: false })
      expect(await readVaultFile(root, 'notes/today.md', 3)).toEqual({ content: '# t', truncated: true })
      await expect(readVaultFile(root, '../outside.md')).rejects.toThrow(/escapes the vault/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('writes a report once and refuses to overwrite', async () => {
    const root = await fixtureVault()
    try {
      const abs = await writeReport(root, 'Daily', '2026-08-17.md', '# report')
      expect(abs).toBe(join(root, 'Daily', '2026-08-17.md'))
      expect(await reportExists(root, 'Daily', '2026-08-17.md')).toBe(true)
      await expect(writeReport(root, 'Daily', '2026-08-17.md', '# again')).rejects.toMatchObject({ code: 'EEXIST' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('skips hidden and bookkeeping directories and descends into nested ones', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      await mkdir(join(root, 'nested'), { recursive: true })
      await mkdir(join(root, '.git'), { recursive: true })
      await mkdir(join(root, '.hidden'), { recursive: true })
      await writeFile(join(root, 'nested', 'deep.md'), '# deep')
      await writeFile(join(root, '.git', 'skip.md'), '# skip')
      await writeFile(join(root, '.hidden', 'skip2.md'), '# skip2')
      const files = await listModifiedFiles(root, 0)
      expect(files).toEqual([{ path: 'nested/deep.md', size: 7 }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('reports a missing report file as not existing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      expect(await reportExists(root, 'Daily', '2026-08-17.md')).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
```

- [ ] **步骤 2：运行确认失败**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/fs.spec.ts
```
预期：FAIL（模块不存在）。

- [ ] **步骤 3：实现**

```ts
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertContained, resolveReportPath } from './paths.ts'

export interface ModifiedFile {
  /** Vault-relative path with forward slashes. */
  path: string
  /** Byte size. */
  size: number
}

/** Directories never scanned for notes. */
const SKIP_DIRECTORIES = new Set(['.git', '.obsidian', '.trash', 'node_modules'])

/** Recursively list .md files under the vault with mtime >= sinceMs. */
export async function listModifiedFiles(vaultPath: string, sinceMs: number): Promise<ModifiedFile[]> {
  const found: ModifiedFile[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !SKIP_DIRECTORIES.has(entry.name)) {
          await walk(join(dir, entry.name))
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const abs = join(dir, entry.name)
        const info = await stat(abs)
        if (info.mtimeMs >= sinceMs) {
          found.push({ path: abs.slice(vaultPath.length + 1).replaceAll('\\', '/'), size: info.size })
        }
      }
    }
  }
  await walk(vaultPath)
  found.sort((a, b) => a.path.localeCompare(b.path))
  return found
}

/** Read one contained vault file with a byte cap; `truncated` flags the cut. */
export async function readVaultFile(
  vaultPath: string,
  relPath: string,
  maxBytes = 64 * 1024,
): Promise<{ content: string; truncated: boolean }> {
  const abs = assertContained(vaultPath, relPath)
  const buffer = await readFile(abs)
  const truncated = buffer.byteLength > maxBytes
  return { content: buffer.subarray(0, maxBytes).toString('utf8'), truncated }
}

/** Write the report; never overwrites an existing file (flag wx). */
export async function writeReport(
  vaultPath: string,
  reportDir: string,
  fileName: string,
  content: string,
): Promise<string> {
  const abs = assertContained(vaultPath, join(reportDir, fileName))
  await mkdir(join(vaultPath, reportDir), { recursive: true })
  await writeFile(abs, content, { flag: 'wx' })
  return abs
}

/** Whether the report file already exists. */
export async function reportExists(vaultPath: string, reportDir: string, fileName: string): Promise<boolean> {
  try {
    await stat(resolveReportPath(vaultPath, reportDir, fileName))
    return true
  } catch {
    return false
  }
}
```

- [ ] **步骤 4：运行确认通过**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/fs.spec.ts
```
预期：PASS。

- [ ] **步骤 5：Commit**

```sh
git add packages/examples/kb-daily/src/fs.ts packages/examples/kb-daily/tests/fs.spec.ts
git commit -m "feat(kb-daily): add vault scan, read, and report-write operations"
```

---

## 任务 6：提示词区段与任务消息

**文件：**
- 创建：`packages/examples/kb-daily/src/prompt.ts`
- 创建：`packages/examples/kb-daily/tests/prompt.spec.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
import { describe, expect, it } from 'vitest'
import { sectionText, taskFraming } from '../src/prompt.ts'

describe('kb-daily prompt content', () => {
  it('section text names the tools and report location', () => {
    const text = sectionText({ reportDir: 'Daily' })
    expect(text).toContain('kb_list_modified')
    expect(text).toContain('kb_read')
    expect(text).toContain('kb_write_report')
    expect(text).toContain('Daily/YYYY-MM-DD.md')
    expect(text).toContain('never modify or delete source notes')
  })
  it('task framing carries the target date', () => {
    const framing = taskFraming('2026-08-17')
    expect(framing).toContain('2026-08-17')
    expect(framing).toContain('KB DAILY TASK')
  })
})
```

- [ ] **步骤 2：运行确认失败**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/prompt.spec.ts
```
预期：FAIL（模块不存在）。

- [ ] **步骤 3：实现**

```ts
/** System-prompt section name contributed by this plugin. */
export const KB_SECTION_NAME = 'kb-daily:task'

export interface SectionConfig {
  reportDir: string
}

/** Stable system-prompt guidance for the knowledge-base daily analyst. */
export function sectionText(config: SectionConfig): string {
  return [
    'You are the knowledge-base daily analyst.',
    `Produce today's daily digest on request:`,
    `1. Call kb_list_modified to find notes changed today (vault-local date).`,
    `2. Read the changed notes with kb_read (vault-relative paths only).`,
    `3. Write a concise Chinese Markdown report with kb_write_report; it lands in ${config.reportDir}/YYYY-MM-DD.md.`,
    'Rules: never modify or delete source notes; never overwrite an existing report;',
    'list every changed file with its vault-relative path and a 1-3 sentence summary each.',
  ].join('\n')
}

/** Follow-up message that starts one daily catch-up run. */
export function taskFraming(date: string): string {
  return [
    `[KB DAILY TASK] Today is ${date}.`,
    'Generate today\'s knowledge-base daily report now: list modified notes, read them, and write the report.',
    'If no notes changed today, still write a short report stating that.',
  ].join('\n')
}
```

- [ ] **步骤 4：运行确认通过**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/prompt.spec.ts
```
预期：PASS。

- [ ] **步骤 5：Commit**

```sh
git add packages/examples/kb-daily/src/prompt.ts packages/examples/kb-daily/tests/prompt.spec.ts
git commit -m "feat(kb-daily): add analyst prompt section and task framing"
```

---

## 任务 7：模型工具（kb_list_modified / kb_read / kb_write_report）

**文件：**
- 创建：`packages/examples/kb-daily/src/tools.ts`
- 创建：`packages/examples/kb-daily/tests/tools.spec.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { dateKey, reportFileName } from '../src/date.ts'
import { registerTools } from '../src/tools.ts'

async function harness(vaultPath: string) {
  const ctx = new Context()
  await ctx.plugin(Timer)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  const dispose = registerTools(ctx, { vaultPath, reportDir: 'Daily', timeZone: 'UTC' })
  const handle = await ctx.agents.create({ sessionId: SessionId('kb-tools') })
  return { ctx, agent: handle.agent, dispose }
}

async function runTool(ctx: Context, agent: Agent, name: string, args: Record<string, unknown>) {
  return ctx.agents.withInitiator(agent, () => ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`kb-${name}`),
    name,
    arguments: args,
    agent,
  }))
}

describe('kb-daily model tools', () => {
  it('kb_list_modified returns changed files since the cutoff', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      await writeFile(join(root, 'a.md'), '# a')
      await utimes(join(root, 'a.md'), new Date(), new Date())
      const { ctx, agent, dispose } = await harness(root)
      const result = await runTool(ctx, agent, 'kb_list_modified', { since: '2026-08-17' })
      expect(result.isError).toBe(false)
      if (!result.isError) {
        expect(Array.isArray(result.value.files)).toBe(true)
        expect(result.value.files.map((file: { path: string }) => file.path)).toContain('a.md')
      }
      dispose()
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('kb_list_modified rejects malformed since dates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      const { ctx, agent, dispose } = await harness(root)
      const result = await runTool(ctx, agent, 'kb_list_modified', { since: 'yesterday' })
      expect(result.isError).toBe(false)
      if (!result.isError) expect(result.value.code).toBe('invalid_date')
      dispose()
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('kb_read reads contained paths and rejects escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      await writeFile(join(root, 'a.md'), '# hello')
      const { ctx, agent, dispose } = await harness(root)
      const ok = await runTool(ctx, agent, 'kb_read', { path: 'a.md' })
      expect(ok.isError).toBe(false)
      if (!ok.isError) expect(ok.value).toEqual({ content: '# hello', truncated: false })
      const bad = await runTool(ctx, agent, 'kb_read', { path: '../escape.md' })
      expect(bad.isError).toBe(false)
      if (!bad.isError) expect(bad.value.code).toBe('read_failed')
      dispose()
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('kb_write_report derives today\'s path and refuses overwrite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      const { ctx, agent, dispose } = await harness(root)
      const date = dateKey(new Date(), 'UTC')
      const first = await runTool(ctx, agent, 'kb_write_report', { content: '# 日报' })
      expect(first.isError).toBe(false)
      if (!first.isError) {
        expect(first.value).toMatchObject({ date, created: true })
        expect(first.value.path).toBe(`Daily/${reportFileName(date)}`)
      }
      const second = await runTool(ctx, agent, 'kb_write_report', { content: '# again' })
      expect(second.isError).toBe(false)
      if (!second.isError) expect(second.value.code).toBe('report_exists')
      dispose()
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('kb_list_modified defaults since to today', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      await writeFile(join(root, 'a.md'), '# a')
      await utimes(join(root, 'a.md'), new Date(), new Date())
      const { ctx, agent, dispose } = await harness(root)
      const result = await runTool(ctx, agent, 'kb_list_modified', {})
      expect(result.isError).toBe(false)
      if (!result.isError) {
        expect(result.value.files.some((file: { path: string }) => file.path === 'a.md')).toBe(true)
      }
      dispose()
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('maps io failures to stable error codes', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    const fileVault = join(tmp, 'not-a-directory')
    await writeFile(fileVault, 'x')
    try {
      const { ctx, agent, dispose } = await harness(fileVault)
      const badList = await runTool(ctx, agent, 'kb_list_modified', { since: '2026-08-17' })
      expect(badList.isError).toBe(false)
      if (!badList.isError) expect(badList.value.code).toBe('list_failed')
      const badRead = await runTool(ctx, agent, 'kb_read', { path: 'nope.md' })
      expect(badRead.isError).toBe(false)
      if (!badRead.isError) expect(badRead.value.code).toBe('read_failed')
      const badWrite = await runTool(ctx, agent, 'kb_write_report', { content: '# x' })
      expect(badWrite.isError).toBe(false)
      if (!badWrite.isError) expect(badWrite.value.code).toBe('write_failed')
      dispose()
      await ctx.fiber.dispose()
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
```

- [ ] **步骤 2：运行确认失败**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/tools.spec.ts
```
预期：FAIL（`../src/tools.ts` 不存在）。

- [ ] **步骤 3：实现 `src/tools.ts`**

```ts
/**
 * Model-facing knowledge-base tools. Registered on the root context so every
 * session can ask the model to inspect the vault; only kb_write_report writes.
 * @module @deepseek-ai/dsh-kb-daily
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type GenericCallView } from '@deepseek-ai/dsh-tools'
import { dateKey, reportFileName } from './date.ts'
import { listModifiedFiles, readVaultFile, writeReport } from './fs.ts'
import { resolveReportPath } from './paths.ts'

export interface ToolsConfig {
  vaultPath: string
  reportDir: string
  timeZone: string
}

const ERROR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
  },
} as const

const FILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    size: { type: 'number', required: true },
  },
} as const

const LIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    files: { type: 'array', items: FILE_SCHEMA },
  },
} as const

const READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    content: { type: 'string', required: true },
    truncated: { type: 'boolean', required: true },
  },
} as const

const WRITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    date: { type: 'string', required: true },
    created: { type: 'boolean', required: true, const: true },
  },
} as const

const REPORT_EXISTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true, const: 'report_exists' },
    message: { type: 'string', required: true },
  },
} as const

function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

function present(title: string, kind: 'read' | 'other', rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

function fail(code: string, message: string): { code: string; message: string } {
  return { code, message }
}

/** Register the three kb tools on the root context; returns an aggregate disposer. */
export function registerTools(ctx: Context, config: ToolsConfig): () => void {
  const disposers: Array<() => void> = []
  try {
    disposers.push(ctx.tools.register(defineTool({
      name: 'kb_list_modified',
      description: 'List Markdown files in the knowledge-base vault modified on or after the given ISO date '
        + '(YYYY-MM-DD, vault-local time). Returns vault-relative paths and byte sizes.',
      parameters: {
        since: { type: 'string', description: 'ISO date YYYY-MM-DD; defaults to today in the vault time zone.' },
      },
      output: { schema: { oneOf: [LIST_SCHEMA, ERROR_SCHEMA] }, render: renderValue },
      async execute(args) {
        const sinceText = args.since ?? dateKey(new Date(), config.timeZone)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceText)) {
          return fail('invalid_date', `since must be YYYY-MM-DD, got ${sinceText}`)
        }
        try {
          const files = await listModifiedFiles(config.vaultPath, Date.parse(`${sinceText}T00:00:00Z`))
          return { files }
        } catch (error) {
          return fail('list_failed', error instanceof Error ? error.message : String(error))
        }
      },
      presentCall: args => present('List modified notes', 'read', args.since),
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: 'kb_read',
      description: 'Read one Markdown file from the knowledge-base vault by vault-relative path. '
        + 'Paths escaping the vault are rejected.',
      parameters: {
        path: { type: 'string', required: true, description: 'Vault-relative file path.' },
      },
      output: { schema: { oneOf: [READ_SCHEMA, ERROR_SCHEMA] }, render: renderValue },
      async execute(args) {
        try {
          return await readVaultFile(config.vaultPath, args.path)
        } catch (error) {
          return fail('read_failed', error instanceof Error ? error.message : String(error))
        }
      },
      presentCall: args => present('Read note', 'read', args.path),
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: 'kb_write_report',
      description: 'Write today\'s knowledge-base daily report. The target path is derived from today\'s date '
        + `in the vault time zone (<reportDir>/YYYY-MM-DD.md); an existing report for today is never overwritten.`,
      parameters: {
        content: { type: 'string', required: true, description: 'Full Markdown report content.' },
      },
      output: { schema: { oneOf: [WRITE_SCHEMA, REPORT_EXISTS_SCHEMA, ERROR_SCHEMA] }, render: renderValue },
      async execute(args) {
        const date = dateKey(new Date(), config.timeZone)
        const fileName = reportFileName(date)
        try {
          const abs = await writeReport(config.vaultPath, config.reportDir, fileName, args.content)
          return { path: abs.slice(config.vaultPath.length + 1).replaceAll('\\', '/'), date, created: true }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            return {
              code: 'report_exists',
              message: `Today's report already exists: ${resolveReportPath(config.vaultPath, config.reportDir, fileName)}`,
            }
          }
          return fail('write_failed', error instanceof Error ? error.message : String(error))
        }
      },
      presentCall: () => present('Write daily report', 'other'),
    })))
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }

  let active = true
  return () => {
    if (!active) return
    active = false
    for (const dispose of disposers.reverse()) dispose()
  }
}
```

- [ ] **步骤 4：运行确认通过**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/tools.spec.ts
```
预期：PASS。

- [ ] **步骤 5：Commit**

```sh
git add packages/examples/kb-daily/src/tools.ts packages/examples/kb-daily/tests/tools.spec.ts
git commit -m "feat(kb-daily): add kb_list_modified, kb_read, kb_write_report tools"
```

---

## 任务 8：写盘审批门

**文件：**
- 创建：`packages/examples/kb-daily/src/approval.ts`
- 创建：`packages/examples/kb-daily/tests/approval.spec.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { registerTools } from '../src/tools.ts'
import { registerWriteApproval } from '../src/approval.ts'

async function harness(vaultPath: string, writePolicy: 'ask' | 'allow') {
  const ctx = new Context()
  await ctx.plugin(Timer)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  const disposeTools = registerTools(ctx, { vaultPath, reportDir: 'Daily', timeZone: 'UTC' })
  const disposeApproval = registerWriteApproval(ctx, { writePolicy, reportDir: 'Daily' })
  const handle = await ctx.agents.create({ sessionId: SessionId('kb-approval') })
  return {
    ctx,
    agent: handle.agent,
    dispose: () => { disposeApproval(); disposeTools() },
  }
}

async function writeReport(ctx: Context, agent: Agent) {
  return ctx.agents.withInitiator(agent, () => ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('kb-approval-write'),
    name: 'kb_write_report',
    arguments: { content: '# 日报' },
    agent,
  }))
}

describe('kb-daily write approval gate', () => {
  it('ask policy routes through approval and fails closed without a channel', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      const { ctx, agent, dispose } = await harness(root, 'ask')
      const result = await writeReport(ctx, agent)
      expect(result.isError).toBe(true)
      if (result.isError) expect(result.error).toMatch(/approval/i)
      dispose()
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('allow policy writes through without approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      await writeFile(join(root, 'a.md'), '# a')
      const { ctx, agent, dispose } = await harness(root, 'allow')
      const result = await writeReport(ctx, agent)
      expect(result.isError).toBe(false)
      dispose()
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('passes other tools through untouched under ask', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      await writeFile(join(root, 'a.md'), '# a')
      const { ctx, agent, dispose } = await harness(root, 'ask')
      const result = await ctx.agents.withInitiator(agent, () => ctx.tools.execute({
        signal: new AbortController().signal,
        callId: CallId('kb-approval-list'),
        name: 'kb_list_modified',
        arguments: { since: '2026-08-17' },
        agent,
      }))
      expect(result.isError).toBe(false)
      dispose()
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
```

- [ ] **步骤 2：运行确认失败**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/approval.spec.ts
```
预期：FAIL（`../src/approval.ts` 不存在）。

- [ ] **步骤 3：实现**

```ts
/**
 * Write-approval gate for kb_write_report: `ask` routes through the approval
 * seam (fails closed when no channel exists); `allow` passes through.
 * @module @deepseek-ai/dsh-kb-daily
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'

export interface ApprovalConfig {
  writePolicy: 'ask' | 'allow'
  reportDir: string
}

/** Return one disposer for the pre-execute listener. */
export function registerWriteApproval(ctx: Context, config: ApprovalConfig): () => void {
  return ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (exec.name !== 'kb_write_report' || config.writePolicy === 'allow') return next()
    return { kind: 'ask', reason: `Write the daily knowledge-base report under ${config.reportDir}.` }
  })
}
```

- [ ] **步骤 4：运行确认通过**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/approval.spec.ts
```
预期：PASS（`ask` 无通道时管道按 `no approval channel is available` 拒绝，`allow` 直接写盘）。

- [ ] **步骤 5：Commit**

```sh
git add packages/examples/kb-daily/src/approval.ts packages/examples/kb-daily/tests/approval.spec.ts
git commit -m "feat(kb-daily): gate report writes behind an ask/allow approval policy"
```

---

## 任务 9：补跑守卫与 agent 驱动

**文件：**
- 创建：`packages/examples/kb-daily/src/runner.ts`
- 创建：`packages/examples/kb-daily/tests/runner.spec.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { dateKey } from '../src/date.ts'
import { createGuard, runDailyCheck } from '../src/runner.ts'

describe('kb-daily catch-up guard', () => {
  it('runs once per day, skips when the report exists, and skips while in flight', async () => {
    const calls: string[] = []
    let exists = false
    let release!: () => void
    const gate = createGuard({
      now: () => new Date('2026-08-17T02:00:00Z'),
      timeZone: 'UTC',
      reportExists: async (date) => {
        calls.push(`exists:${date}`)
        return exists
      },
      run: () => {
        calls.push('run')
        return new Promise<void>((resolve) => { release = resolve })
      },
    })
    // First check starts a run and blocks further checks while in flight.
    const first = gate()
    await Promise.resolve()
    expect(calls).toEqual(['exists:2026-08-17', 'run'])
    await gate()
    expect(calls).toEqual(['exists:2026-08-17', 'run'])
    release()
    await first
    // Same day: report still missing but already attempted -> no second run.
    await gate()
    expect(calls).toEqual(['exists:2026-08-17', 'run'])
    // Next day: report exists -> skip.
    exists = true
    const nextDay = createGuard({
      now: () => new Date('2026-08-18T02:00:00Z'),
      timeZone: 'UTC',
      reportExists: async (date) => { calls.push(`exists:${date}`); return exists },
      run: () => { calls.push('run2'); return Promise.resolve() },
    })
    await nextDay()
    expect(calls).toEqual(['exists:2026-08-17', 'run', 'exists:2026-08-18'])
  })
})

describe('kb-daily runDailyCheck', () => {
  it('creates the dedicated agent, queues the task, and reports ran', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      const ctx = new Context()
      await ctx.plugin(Timer)
      await mountAgentLoopTestDependencies(ctx)
      const adapter = new MockAdapter([textResponse('ok')])
      ctx.llm.registerAdapter(['mock'], adapter)
      await ctx.plugin(AgentLoop, { agents: [] })
      const outcome = await runDailyCheck(ctx, {
        vaultPath: root,
        reportDir: 'Daily',
        timeZone: 'UTC',
        agentId: 'kb-daily-guard',
        provider: 'mock',
        model: 'mock',
        checkIntervalMs: 60 * 60 * 1000,
      }, date => `task ${date}`)
      expect(outcome).toBe('ran')
      const agent = ctx.agents.get(SessionId('kb-daily-guard'))
      expect(agent).toBeDefined()
      await agent!.whenIdle()
      expect(adapter.requests).toHaveLength(1)
      expect(adapter.requests[0]?.messages.map(m => m.content.map(b => b.type === 'text' ? b.text : '').join('')).join('\n'))
        .toContain(`task ${dateKey(new Date(), 'UTC')}`)
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports already-done when today\'s report exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      const ctx = new Context()
      await ctx.plugin(Timer)
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(AgentLoop, { agents: [] })
      const date = dateKey(new Date(), 'UTC')
      await import('node:fs/promises').then(fs => fs.mkdir(join(root, 'Daily'), { recursive: true }))
      await import('node:fs/promises').then(fs => fs.writeFile(join(root, 'Daily', `${date}.md`), '# done'))
      const outcome = await runDailyCheck(ctx, {
        vaultPath: root,
        reportDir: 'Daily',
        timeZone: 'UTC',
        agentId: 'kb-daily-done',
        checkIntervalMs: 60 * 60 * 1000,
      }, () => 'task')
      expect(outcome).toBe('already-done')
      expect(ctx.agents.get(SessionId('kb-daily-done'))).toBeUndefined()
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reuses a live dedicated agent when one already exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      const ctx = new Context()
      await ctx.plugin(Timer)
      await mountAgentLoopTestDependencies(ctx)
      const adapter = new MockAdapter([textResponse('ok')])
      ctx.llm.registerAdapter(['mock'], adapter)
      await ctx.plugin(AgentLoop, { agents: [] })
      const existing = await ctx.agents.create({
        sessionId: SessionId('kb-daily-live'),
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      const outcome = await runDailyCheck(ctx, {
        vaultPath: root,
        reportDir: 'Daily',
        timeZone: 'UTC',
        agentId: 'kb-daily-live',
        provider: 'mock',
        model: 'mock',
        checkIntervalMs: 60 * 60 * 1000,
      }, () => 'live task')
      expect(outcome).toBe('ran')
      await existing.agent.whenIdle()
      expect(adapter.requests).toHaveLength(1)
      expect(adapter.requests[0]?.messages
        .map(message => message.content.map(block => block.type === 'text' ? block.text : '').join(''))
        .join('\n')).toContain('live task')
      await existing.dispose()
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resumes the persisted dedicated agent across a restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    const persist = await mkdtemp(join(tmpdir(), 'kb-daily-persist-'))
    try {
      // First process: create the agent and complete one turn so the JSONL backend persists it.
      const first = new Context()
      await mountAgentLoopTestDependencies(first)
      await first.plugin(AgentLoop, { agents: [] })
      await first.plugin(JsonlSessionPersistence, { root: persist, compression: 'none' })
      const firstAdapter = new MockAdapter([textResponse('first')])
      first.llm.registerAdapter(['mock'], firstAdapter)
      const created = await first.agents.create({
        sessionId: SessionId('kb-daily-restart'),
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      created.agent.followup(createUserMessage({
        content: [{ type: 'text', text: 'seed' }],
        source: { kind: 'plugin', plugin: 'kb-daily' },
      }))
      await created.agent.whenIdle()
      await first.sessions.flush(created.agent.session)
      await created.dispose()
      await first.fiber.dispose()

      // Second process: runDailyCheck must resume the persisted session.
      const second = new Context()
      await mountAgentLoopTestDependencies(second)
      await second.plugin(AgentLoop, { agents: [] })
      await second.plugin(JsonlSessionPersistence, { root: persist, compression: 'none' })
      const secondAdapter = new MockAdapter([textResponse('second')])
      second.llm.registerAdapter(['mock'], secondAdapter)
      const outcome = await runDailyCheck(second, {
        vaultPath: root,
        reportDir: 'Daily',
        timeZone: 'UTC',
        agentId: 'kb-daily-restart',
        provider: 'mock',
        model: 'mock',
        checkIntervalMs: 60 * 60 * 1000,
      }, () => 'restart task')
      expect(outcome).toBe('ran')
      const resumed = second.agents.get(SessionId('kb-daily-restart'))
      expect(resumed).toBeDefined()
      await resumed!.whenIdle()
      expect(secondAdapter.requests[0]?.messages
        .map(message => message.content.map(block => block.type === 'text' ? block.text : '').join(''))
        .join('\n')).toContain('restart task')
      await second.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(persist, { recursive: true, force: true })
    }
  })
})
```

- [ ] **步骤 2：运行确认失败**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/runner.spec.ts
```
预期：FAIL（`../src/runner.ts` 不存在）。

- [ ] **步骤 3：实现 `src/runner.ts`**

```ts
/**
 * Daily catch-up runner: on load and then on a fixed interval, checks whether
 * today's report exists; when missing, drives the dedicated KB agent.
 * @module @deepseek-ai/dsh-kb-daily
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { dateKey, reportFileName } from './date.ts'
import { reportExists } from './fs.ts'

export interface RunnerConfig {
  vaultPath: string
  reportDir: string
  timeZone: string
  agentId: string
  provider?: string
  model?: string
  checkIntervalMs: number
}

export type CheckOutcome = 'ran' | 'already-done'

/** Create/resume the dedicated agent, then queue one task turn. */
export async function runDailyCheck(
  ctx: Context,
  config: RunnerConfig,
  taskText: (date: string) => string,
): Promise<CheckOutcome> {
  const date = dateKey(new Date(), config.timeZone)
  if (await reportExists(config.vaultPath, config.reportDir, reportFileName(date))) {
    return 'already-done'
  }
  const id = SessionId(config.agentId)
  const agentOptions = {
    ...(config.provider !== undefined ? { provider: config.provider } : {}),
    ...(config.model !== undefined ? { model: config.model } : {}),
  }
  const message = createUserMessage({
    content: [{ type: 'text', text: taskText(date) }],
    source: { kind: 'plugin', plugin: 'kb-daily' },
  })
  const existing = ctx.agents.get(id)
  if (existing !== undefined) {
    existing.followup(message)
    return 'ran'
  }
  let handle: AgentHandle
  try {
    handle = await ctx.agents.resume({ resumeSessionId: id, agentOptions })
  } catch {
    handle = await ctx.agents.create({ sessionId: id, agentOptions })
  }
  handle.agent.followup(message)
  return 'ran'
}

export interface GuardDeps {
  now: () => Date
  timeZone: string
  reportExists: (date: string) => Promise<boolean>
  run: () => Promise<void>
}

/**
 * Once-per-day + in-flight guards around the daily run. A failed or rejected
 * attempt marks the day attempted, so it is not retried until restart or the
 * next day (per design: never nag within the same day).
 */
export function createGuard(deps: GuardDeps): () => Promise<void> {
  let attemptedDay: string | undefined
  let inFlight = false
  return async () => {
    if (inFlight) return
    const day = dateKey(deps.now(), deps.timeZone)
    if (attemptedDay === day) return
    if (await deps.reportExists(day)) return
    attemptedDay = day
    inFlight = true
    try {
      await deps.run()
    } finally {
      inFlight = false
    }
  }
}

/** Start the catch-up runner: one immediate check plus a fixed-interval re-check. */
export function startRunner(
  ctx: Context,
  config: RunnerConfig,
  taskText: (date: string) => string,
): () => void {
  const guard = createGuard({
    now: () => new Date(),
    timeZone: config.timeZone,
    reportExists: async (date) => reportExists(config.vaultPath, config.reportDir, reportFileName(date)),
    run: () => runDailyCheck(ctx, config, taskText),
  })
  void guard()
  const stopTimer = ctx.interval(guard, config.checkIntervalMs)
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    stopTimer()
  }
}
```

- [ ] **步骤 4：运行确认通过**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/runner.spec.ts
```
预期：PASS。

- [ ] **步骤 5：Commit**

```sh
git add packages/examples/kb-daily/src/runner.ts packages/examples/kb-daily/tests/runner.spec.ts
git commit -m "feat(kb-daily): add once-per-day catch-up guard and agent driver"
```

---

## 任务 10：装配插件入口 + 组合测试

**文件：**
- 修改：`packages/examples/kb-daily/src/index.ts`
- 修改：`packages/examples/kb-daily/tests/plugin.spec.ts`

- [ ] **步骤 1：编写失败的组合测试（追加到 plugin.spec.ts）**

```ts
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as kbDaily from '../src/index.ts'
import { KB_SECTION_NAME } from '../src/prompt.ts'

async function harness(vaultPath: string, config: Partial<kbDaily.Config> = {}) {
  const ctx = new Context()
  await ctx.plugin(Timer)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  const plugin = await ctx.plugin(kbDaily, { vaultPath, writePolicy: 'allow', ...config })
  return { ctx, plugin }
}

describe('kb-daily plugin composition', () => {
  it('registers the section, tools, and dedicated agent, and unwinds on disposal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    await mkdir(join(root, 'notes'), { recursive: true })
    try {
      const { ctx, plugin } = await harness(root, { agentId: 'kb-daily-comp', timeZone: 'UTC', checkIntervalMs: 60 * 60 * 1000 })
      const assembly = await ctx.systemPrompt.assemble()
      expect(assembly.sections.find(section => section.name === KB_SECTION_NAME)?.text).toContain('kb_write_report')
      expect(ctx.tools.get('kb_list_modified')?.name).toBe('kb_list_modified')
      expect(ctx.tools.get('kb_read')?.name).toBe('kb_read')
      expect(ctx.tools.get('kb_write_report')?.name).toBe('kb_write_report')
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(ctx.agents.get(SessionId('kb-daily-comp'))).toBeDefined()

      await plugin.dispose()
      expect(ctx.tools.get('kb_list_modified')).toBeUndefined()
      expect(ctx.tools.get('kb_read')).toBeUndefined()
      expect(ctx.tools.get('kb_write_report')).toBeUndefined()
      const after = await ctx.systemPrompt.assemble()
      expect(after.sections.find(section => section.name === KB_SECTION_NAME)).toBeUndefined()
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails fast on an unreadable vaultPath', async () => {
    const ctx = new Context()
    await ctx.plugin(Timer)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await expect(ctx.plugin(kbDaily, { vaultPath: join(tmpdir(), 'kb-daily-missing-vault') }))
      .rejects.toThrow(/vaultPath/)
    await ctx.fiber.dispose()
  })

  it('asks before writes under the ask policy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      const ctx = new Context()
      await ctx.plugin(Timer)
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(kbDaily, { vaultPath: root, writePolicy: 'ask', agentId: 'kb-daily-ask', timeZone: 'UTC', checkIntervalMs: 60 * 60 * 1000 })
      const agent = ctx.agents.get(SessionId('kb-daily-ask'))!
      await agent.whenIdle()
      const result = await ctx.agents.withInitiator(agent, () => ctx.tools.execute({
        signal: new AbortController().signal,
        callId: CallId('kb-ask-write'),
        name: 'kb_write_report',
        arguments: { content: '# 日报' },
        agent,
      }))
      expect(result.isError).toBe(true)
      if (result.isError) expect(result.error).toMatch(/approval/i)
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
```
注意：`ask` 测试中 agent 由插件补跑创建（无 adapter 时其首回合以 NO_ADAPTER 错误结束，`whenIdle` 仍会返回）；`ctx.tools.execute` 在 open turn 之外调用时审批通道返回 unavailable → 管道按拒绝处理，断言 `approval` 匹配即可（若实际文案不同，按 `packages/core/tools/src/index.ts` 第 1691-1724 行的决策文案调整断言）。

- [ ] **步骤 2：运行确认失败**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/plugin.spec.ts
```
预期：新增用例 FAIL（apply 还是 no-op）。

- [ ] **步骤 3：实现入口装配（替换 `apply` 桩）**

在 `src/index.ts` 顶部追加导入，并替换 `apply`：

```ts
import { statSync } from 'node:fs'
import { registerTools } from './tools.ts'
import { registerWriteApproval } from './approval.ts'
import { KB_SECTION_NAME, sectionText, taskFraming } from './prompt.ts'
import { startRunner } from './runner.ts'
```

```ts
/** Wire the section, tools, approval gate, and catch-up runner. */
export function apply(ctx: Context, config: Config): void {
  const reportDir = config.reportDir
  const timeZone = config.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const agentId = config.agentId
  const writePolicy = config.writePolicy
  const checkIntervalMs = config.checkIntervalMs

  if (!statSync(config.vaultPath).isDirectory()) {
    throw new Error(`kb-daily: vaultPath is not a readable directory: ${config.vaultPath}`)
  }

  ctx.effect(() => {
    const disposeSection = ctx.systemPrompt.section({
      name: KB_SECTION_NAME,
      order: 200,
      text: sectionText({ reportDir }),
    })
    const disposeTools = registerTools(ctx, { vaultPath: config.vaultPath, reportDir, timeZone })
    const disposeApproval = registerWriteApproval(ctx, { writePolicy, reportDir })
    const stopRunner = startRunner(ctx, {
      vaultPath: config.vaultPath,
      reportDir,
      timeZone,
      agentId,
      provider: config.provider,
      model: config.model,
      checkIntervalMs,
    }, taskFraming)
    return () => {
      stopRunner()
      disposeApproval()
      disposeTools()
      disposeSection()
    }
  }, 'kb-daily.lifecycle()')
}
```

- [ ] **步骤 4：运行确认通过**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/plugin.spec.ts
```
预期：PASS（含导出形状用例与三个组合用例）。

- [ ] **步骤 5：Commit**

```sh
git add packages/examples/kb-daily/src/index.ts packages/examples/kb-daily/tests/plugin.spec.ts
git commit -m "feat(kb-daily): wire plugin entry, section, tools, approval, and runner"
```

---

## 任务 11：端到端集成测试（mock 模型驱动全链路）

**文件：**
- 创建：`packages/examples/kb-daily/tests/run.spec.ts`

- [ ] **步骤 1：编写测试**

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { dateKey, reportFileName } from '../src/date.ts'
import * as kbDaily from '../src/index.ts'

describe('kb-daily end-to-end run', () => {
  it('opens, catches up, drives the agent through the kb tools, and writes the report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    await mkdir(join(root, 'notes'), { recursive: true })
    await writeFile(join(root, 'notes', 'idea.md'), '# idea')
    try {
      const ctx = new Context()
      await ctx.plugin(Timer)
      await mountAgentLoopTestDependencies(ctx)
      const adapter = new MockAdapter([
        toolCallResponse('list', 'kb_list_modified', { since: dateKey(new Date(), 'UTC') }),
        toolCallResponse('read', 'kb_read', { path: 'notes/idea.md' }),
        toolCallResponse('write', 'kb_write_report', { content: '# 2026-08-17 日报\n\n- notes/idea.md' }),
        textResponse('done'),
      ])
      ctx.llm.registerAdapter(['mock'], adapter)
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(kbDaily, {
        vaultPath: root,
        writePolicy: 'allow',
        timeZone: 'UTC',
        agentId: 'kb-daily-e2e',
        provider: 'mock',
        model: 'mock',
        checkIntervalMs: 60 * 60 * 1000,
      })

      const agent = ctx.agents.get(SessionId('kb-daily-e2e'))
      expect(agent).toBeDefined()
      await agent!.whenIdle()

      expect(adapter.requests.length).toBeGreaterThanOrEqual(3)
      const reportPath = join(root, 'Daily', reportFileName(dateKey(new Date(), 'UTC')))
      const report = await readFile(reportPath, 'utf8')
      expect(report).toContain('notes/idea.md')
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
```
说明：MockAdapter 顺序提供 3 次工具调用响应 + 1 次文本收尾；模型回合依次触发真实 `kb_list_modified`/`kb_read`/`kb_write_report`，工具实际读写临时 vault；最终断言 `Daily/<今天>.md` 存在且包含笔记路径。若 `toolCallResponse` 的调用关联需要精确 `callId`，以 `packages/examples/agent-spine-demo/tests/agent-core.spec.ts` 第 448-459 行的用法为准。

- [ ] **步骤 2：运行确认失败**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests/run.spec.ts
```
预期：FAIL（模块 `run.spec.ts` 引用的行为依赖任务 10 装配；若任务 10 已完成则本步直接 PASS——若 PASS 跳过步骤 3 的失败预期，直接进入步骤 4）。

- [ ] **步骤 3：如需修复，检查并调整**

常见修复点：mock 响应序列与模型回合数不匹配（加/减 `toolCallResponse`）；`since` 参数与 `dateKey` 一致；`checkIntervalMs` 足够大避免测试期间二次触发。修完重复步骤 2。

- [ ] **步骤 4：Commit**

```sh
git add packages/examples/kb-daily/tests/run.spec.ts
git commit -m "test(kb-daily): drive the full catch-up flow with a mock model"
```

---

## 任务 12：包 README（双语三件套）

**文件：**
- 创建：`packages/examples/kb-daily/README.md`
- 创建：`packages/examples/kb-daily/README.zh.md`
- 创建：`packages/examples/kb-daily/README.i18n.yaml`（由校验命令生成）

- [ ] **步骤 1：编写 README.md**

```markdown
# @deepseek-ai/dsh-kb-daily

English | [中文](README.zh.md)

Daily catch-up knowledge-base digest. On load — and then on a fixed interval —
the plugin checks whether today's report file exists in the vault; when missing
it creates or resumes a dedicated `kb-daily` agent and queues one task turn. The
agent lists notes changed today, reads them, and writes
`<reportDir>/YYYY-MM-DD.md` (default `Daily`).

## Composition

Mount the plugin over a composition that already provides `agents`, `tools`,
`systemPrompt`, and the `timer` service (the shipped `dsh-base` bundle provides
`cordis-plugin-timer`):

```yaml
- insert:
    - id: kb-daily
      name: '@deepseek-ai/dsh-kb-daily'
      config:
        vaultPath: /absolute/path/to/your/vault
        # writePolicy: ask   # ask before writing (default)
        # writePolicy: allow # write without asking
```

## Config

| Field | Default | Meaning |
|---|---|---|
| `vaultPath` | — (required) | Absolute path to the Markdown vault |
| `reportDir` | `Daily` | Subdirectory that receives `YYYY-MM-DD.md` reports |
| `timeZone` | system zone | IANA zone used to compute "today" |
| `agentId` | `kb-daily` | Stable session id of the dedicated agent |
| `provider` / `model` | deployment-resolved | Route for the dedicated agent |
| `writePolicy` | `ask` | `ask` routes the report write through the approval seam; `allow` writes without asking |
| `checkIntervalMs` | `3600000` | Day-rollover re-check interval |

## Tools

`kb_list_modified` lists `.md` files modified since a date; `kb_read` reads one
contained file (paths escaping the vault are rejected); `kb_write_report` writes
today's report — the path is derived from the date, never from model input, and
an existing report is never overwritten.

## Architecture

The plugin is a Cordis function plugin (`name`/`inject`/`apply`/`Config`, no
default export). `apply` registers one system-prompt section (`kb-daily:task`,
order 200), the three tools on the root context, a `tools/pre-execute` gate that
returns `{ kind: 'ask' }` for `kb_write_report` under `writePolicy: ask`, and a
catch-up runner: a once-per-day + in-flight guard calls `ctx.agents.resume`
(falling back to `ctx.agents.create`) and queues the task with
`agent.followup(createUserMessage(...))`. All file access uses
`node:fs/promises` behind path-containment checks.

## Model Experience

### Request context and condition

#### What the model sees

Every request includes the `kb-daily:task` section (the analyst rules above),
and the three tool schemas. Each scheduled catch-up run appends one
`[KB DAILY TASK]` user message carrying the target date.

#### Token effect

Fixed section + schema prefix on every request; one data-dependent task message
per catch-up run. Tool calls and results flow through the ordinary pipeline.

#### KV Cache effect

Append-only under a stable section/schema/order; the task message and tool
results affect only the appended suffix.

## Known Limitations and Deferred Work

- **Once per day, catch-up only** — a failed or user-rejected run is not retried
  until a restart or the next day; only the current day is produced, never a
  backfill of missed dates.
- **Requires the process to be running** — dsh must be open for the plugin to
  catch up; there is no OS-level scheduling yet.
- **Quality depends on the model** — the plugin guarantees the chain and the
  report file, not the summary quality.
- **Resume needs persistence** — without a `sessionPersistence` backend the
  dedicated agent is recreated fresh on every run.
- **Timer required** — the composition must mount `cordis-plugin-timer`
  (provided by `dsh-base`).
```

- [ ] **步骤 2：编写 README.zh.md（结构镜像，中文内容）**

对照 README.md 逐节翻译，首行 H1 后保留切换器 `[English](README.md) | 中文`；标题层级、表格行列、列表类型与数量、链接目标必须与英文版一一对应。内容要点：每日补跑摘要、组合方式（含 cordis.yml 示例）、Config 表、三个工具、架构说明（Cordis 函数插件、ask 审批门、守卫 + resume/create + followup）、Model Experience 三小节、已知限制五条。

- [ ] **步骤 3：生成并校验配对记录**

```sh
pnpm run verify-translation-pairing --write packages/examples/kb-daily/README
```
预期：写入 `README.i18n.yaml`（两个 blob 哈希）且命令退出码 0；若结构签名报错，按报错修正两文件（标题层级/表格/代码块一致）后重跑。

- [ ] **步骤 4：Commit**

```sh
git add packages/examples/kb-daily/README.md packages/examples/kb-daily/README.zh.md packages/examples/kb-daily/README.i18n.yaml
git commit -m "docs(kb-daily): add bilingual package README"
```

---

## 任务 13：示例 overlay

**文件：**
- 创建：`examples/kb-daily/cordis.yml`
- 创建：`examples/kb-daily/README.md`、`examples/kb-daily/README.zh.md`、`examples/kb-daily/README.i18n.yaml`
- 修改：`examples/package.json`（dependencies 增加 `@deepseek-ai/dsh-kb-daily`）

- [ ] **步骤 1：创建 cordis.yml**

```yaml
# Opt-in Knowledge-Base daily digest overlay over the shipped Web composition.
# Point config.vaultPath at your Markdown vault (Obsidian works), then run:
#   pnpm dsh web --patch examples/kb-daily/cordis.yml
- insert:
    - id: kb-daily
      name: '@deepseek-ai/dsh-kb-daily'
      config:
        vaultPath: /absolute/path/to/your/vault
```

- [ ] **步骤 2：修改 examples/package.json**

在 `dependencies` 中（按字母序附近）增加一行：

```json
"@deepseek-ai/dsh-kb-daily": "workspace:*",
```
然后 `pnpm install`。

- [ ] **步骤 3：编写示例 README 三件套**

`examples/kb-daily/README.md`（简短：用途、启用命令 `pnpm dsh web --patch examples/kb-daily/cordis.yml`、先改 `vaultPath`、默认 `ask` 审批、日报位置 `Daily/YYYY-MM-DD.md`、参考链接）＋镜像的 `README.zh.md`，然后：

```sh
pnpm run verify-translation-pairing --write examples/kb-daily/README
```

- [ ] **步骤 4：验证 overlay 引用可解析**

```sh
pnpm run verify-cordis-config
```
预期：通过（`examples/package.json` 已声明该包；若报其它 overlay 引用缺失，是既有问题，单独记录不要顺手修改）。

- [ ] **步骤 5：Commit**

```sh
git add examples/kb-daily examples/package.json
git commit -m "feat(kb-daily): add web overlay example"
```

---

## 任务 14：全量仓库门禁

**文件：** 无新增；按门禁输出修复。

- [ ] **步骤 1：运行文档门禁**

```sh
pnpm run doc-sync
```
预期：退出码 0。若 `gen-config-catalog`/`gen-cordis-api` 因新包生成文档差异而失败，按 diff 提交生成产物（`docs/config-catalog.md` 等）。

- [ ] **步骤 2：运行约束/类型/静态检查**

```sh
pnpm run constraints && pnpm run typecheck && pnpm run lint
```
预期：全部退出码 0。`constraints` 会核对 package.json 不变量（version 匹配、peer/dev 镜像、files 列表）；按报错修正。

- [ ] **步骤 3：构建 + 卫生检查**

```sh
pnpm run build && pnpm run hygiene
```
预期：全部退出码 0。`hygiene` 含 knip/publint/`verify-cordis-config` 等；knip 若报未用依赖，从 devDependencies 移除；`verify-built-package-invariants` 若报 `files` 与产物不符，按报错调整 `files`。

- [ ] **步骤 4：运行覆盖率门（全量）**

```sh
pnpm run test:coverage
```
预期：全部通过。若 kb-daily 的 src 文件有未覆盖位置，报告会指向具体行（`scripts/coverage-uncovered-locations.cjs`）；按任务 3-9 中已有的测试模式补断言（每个缺口必须是有意义的行为测试；`v8 ignore` 仅在有理由时使用，见 `vitest.config.ts` 第 269-272 行注释）。重复本步骤直至 100%。（注意：覆盖率门是全仓每文件 100%，必须用全量命令跑，路径过滤运行会误报其它包 0%。）

- [ ] **步骤 5：全量跑新包测试**

```sh
pnpm exec vitest run packages/examples/kb-daily/tests
```
预期：全部 PASS。

- [ ] **步骤 6：Commit**

```sh
git add packages/examples/kb-daily examples/kb-daily examples/package.json tsconfig.host.json docs
git commit -m "chore(kb-daily): satisfy repository gates"
```
注意：显式列出路径，**不要用 `git add -A`**——仓库暂存区里有 6 个既存的 `.dsh-local` 本地状态文件（profile/settings/storage），必须保持不提交。

---

## 自检结论（计划编写时已执行）

1. **规格覆盖度**：规格的架构（专用会话、宿主侧补跑、3 工具 + 区段、ask/allow 写盘、每小时复查）、数据流（加载→检查→resume/create→followup→工具链→落盘）、错误处理（配置失败快速失败、同日不重试、写盘幂等、路径包含性）、测试计划（单测 + MockAdapter 集成 + 手工 overlay 验证）逐条映射到任务 1-14。手工验证步骤并入任务 13（overlay 提供 `dsh web --patch` 用法）。
2. **占位符扫描**：无 TODO/待定；每个步骤含完整代码或精确命令。
3. **类型一致性**：`dateKey`/`reportFileName`/`assertContained`/`reportExists`/`runDailyCheck`/`createGuard`/`startRunner`/`registerTools`/`registerWriteApproval`/`taskFraming`/`sectionText` 的签名在所有任务中一致；`Config` 字段名（`vaultPath`/`reportDir`/`timeZone`/`agentId`/`provider`/`model`/`writePolicy`/`checkIntervalMs`）在 index/tools/approval/runner 间一致。
