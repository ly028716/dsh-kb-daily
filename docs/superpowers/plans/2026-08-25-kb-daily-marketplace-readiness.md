# DSH KB Daily Marketplace Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `dsh-kb-daily` into an independently installable, safely runnable DeepSeek Harness bundle that can be published and presented in the community plugin showcase.

**Architecture:** Keep the existing Cordis function-plugin runtime (`src/index.ts`) and its public DSH service integrations. Add a DSH bundle layer that mounts that entry, make the npm/Git distribution self-building, then close the two observed correctness gaps: nondeterministic report dates and lexical-only path containment. CI must validate the packed artifact in a real DSH profile, rather than only importing source through a Cordis Loader.

**Tech Stack:** TypeScript 6, pnpm 10, Vitest 4, Cordis 4, published `@deepseek-ai/dsh-*` packages, DeepSeek Harness CLI, GitHub Actions.

**Spec:** `docs/2026-08-17-kb-daily-plugin-design.md`; `docs/2026-08-17-kb-daily-plugin.md`; [DeepSeek Harness package-and-install guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md).

## Global Constraints

- Publish as the community-owned package `@ly028716/dsh-kb-daily`; never use the `@deepseek-ai` namespace for this independent project.
- Use only published DeepSeek Harness and Cordis APIs. Do not add `workspace:` dependencies or import upstream private source files.
- Preserve the existing configuration fields: `vaultPath`, `reportDir`, `timeZone`, `agentId`, `provider`, `model`, `writePolicy`, and `checkIntervalMs`.
- `writePolicy: ask` must keep using the host `tools/pre-execute` approval path and fail closed without a host approval channel.
- Every registry entry, listener, timer, and agent handle must remain owned by `ctx.effect()` / `ctx.on()` and be disposed on unload.
- Support both `dsh plugin --profile <name> add github:ly028716/dsh-kb-daily#<commit>` and installation from a prebuilt npm/tarball package.
- Do not publish, create a GitHub release, or post a community discussion until every command in the final verification task passes.

---

## Planned File Structure

| File | Responsibility |
| --- | --- |
| `package.json` | Community package identity, bundle manifest, scripts, packaged files, CLI test dependency. |
| `cordis.patch.yml` | DSH bundle layer that inserts the `kb-daily` plugin row. |
| `LICENSE` | Actual MIT license text matching the package metadata. |
| `src/paths.ts` | Lexical and physical containment validation; reject symbolic-link escapes. |
| `src/fs.ts` | Use physical containment checks before reading and creating reports. |
| `src/tools.ts` | Injectable clock for deterministic report-date calculations. |
| `tests/package.spec.ts` | Assert package/bundle metadata and packed-export contract. |
| `tests/paths.spec.ts`, `tests/fs.spec.ts` | Verify symbolic-link escape rejection for read and write paths. |
| `tests/tools.spec.ts` | Freeze the clock and assert exact UTC and non-UTC report dates. |
| `scripts/smoke-dsh.mjs` | Build a temporary DSH profile, install the packed tarball, and assert the bundle layer resolves. |
| `.github/workflows/ci.yml` | Run typecheck, unit tests, package inspection, and DSH-profile smoke test for every push and pull request. |
| `README.md`, `README.zh.md` | Correct install, safety, ownership, configuration, release, and community-posting guidance. |
| `docs/community-showcase.md` | Ready-to-paste DSH community post, screenshot checklist, and release checklist. |

---

### Task 1: Correct package ownership and make it a DSH bundle

**Files:**

- Create: `cordis.patch.yml`
- Create: `LICENSE`
- Create: `tests/package.spec.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**

- Produces the package contract consumed by `dsh plugin --profile <name> add ...`:

```json
{
  "name": "@ly028716/dsh-kb-daily",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

- Produces the bundle row consumed by DSH Loader:

```yaml
- insert:
    - id: kb-daily
      name: '@ly028716/dsh-kb-daily'
```

- Consumes the existing named plugin exports from `src/index.ts` via `lib/index.js`.

- [ ] **Step 1: Write the failing package-contract test**

Create `tests/package.spec.ts` with assertions that describe the shipped artifact, not only the source tree:

```ts
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('published bundle contract', () => {
  it('declares a community-owned DSH bundle and ships its patch', async () => {
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
    const patch = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')
    expect(pkg.name).toBe('@ly028716/dsh-kb-daily')
    expect(pkg.repository.url).toBe('git+https://github.com/ly028716/dsh-kb-daily.git')
    expect(pkg.dsh).toEqual({ bundle: { patch: './cordis.patch.yml' } })
    expect(pkg.files).toContain('cordis.patch.yml')
    expect(pkg.files).toContain('LICENSE')
    expect(pkg.scripts.prepare).toBe('pnpm run build')
    expect(pkg.scripts.prepack).toBe('pnpm run build')
    expect(patch).toContain("id: kb-daily")
    expect(patch).toContain("name: '@ly028716/dsh-kb-daily'")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/package.spec.ts`

Expected: FAIL because the existing package still uses `@deepseek-ai/dsh-kb-daily`, has no `dsh` manifest, no `prepare`, and no patch file.

- [ ] **Step 3: Replace the package metadata and add the bundle files**

Change the relevant `package.json` fields to the following values. Keep the current peer dependency set and versions unchanged in this task.

```json
{
  "name": "@ly028716/dsh-kb-daily",
  "description": "Timezone-aware daily Markdown digests for DeepSeek Harness knowledge bases.",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/ly028716/dsh-kb-daily.git"
  },
  "homepage": "https://github.com/ly028716/dsh-kb-daily#readme",
  "bugs": {
    "url": "https://github.com/ly028716/dsh-kb-daily/issues"
  },
  "keywords": ["deepseek-harness", "dsh-plugin", "cordis", "knowledge-base", "daily-report"],
  "packageManager": "pnpm@10.15.0",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "prepare": "pnpm run build",
    "prepack": "pnpm run build",
    "smoke:dsh": "node scripts/smoke-dsh.mjs"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

Remove the broken `"./src/*": "./src/*"` export because `src/` is intentionally absent from the packed artifact. Add `cordis.patch.yml` and `LICENSE` to the `files` array. Add `.pnpm-store/` to `.gitignore` if it is not already present; keep `lib/` ignored because `prepare` and `prepack` generate it.

Create `cordis.patch.yml` exactly as follows:

```yaml
- insert:
    - id: kb-daily
      name: '@ly028716/dsh-kb-daily'
```

Create `LICENSE` using the standard MIT text with `Copyright (c) 2026 ly028716`.

- [ ] **Step 4: Run the focused package tests and inspect the tarball**

Run:

```sh
pnpm exec vitest run tests/package.spec.ts
pnpm pack --dry-run
```

Expected: the test passes; the dry-run listing contains `cordis.patch.yml`, `LICENSE`, and `lib/index.js`; it does not list `src/`.

- [ ] **Step 5: Commit the independently installable bundle contract**

```sh
git add package.json pnpm-lock.yaml .gitignore cordis.patch.yml LICENSE tests/package.spec.ts
git commit -m "feat: package kb daily as a DSH community bundle"
```

### Task 2: Make report-date behavior deterministic and repair the failing test gate

**Files:**

- Modify: `src/tools.ts`
- Modify: `tests/tools.spec.ts`
- Modify: `README.md`
- Modify: `README.zh.md`

**Interfaces:**

- Extend `ToolsConfig` with `now?: () => Date` for tests and embedded hosts.
- Production behavior remains `new Date()` when `now` is absent.
- `kb_list_modified` and `kb_write_report` use the same injected clock.

- [ ] **Step 1: Replace the date-dependent assertion with a failing fixed-clock test**

In `tests/tools.spec.ts`, configure the first test with this clock and assert the exact report path:

```ts
const config: ToolsConfig = {
  vaultPath: root,
  reportDir: 'Daily',
  timeZone: 'UTC',
  now: () => new Date('2026-08-24T23:30:00.000Z'),
}

expect(written).toMatchObject({ date: '2026-08-24', created: true })
expect(await readFile(join(root, 'Daily', '2026-08-24.md'), 'utf8')).toBe('# report')
```

Add a second exact-boundary assertion:

```ts
const config: ToolsConfig = {
  vaultPath: root,
  reportDir: 'Daily',
  timeZone: 'Asia/Shanghai',
  now: () => new Date('2026-08-24T16:30:00.000Z'),
}

expect(value).toMatchObject({ date: '2026-08-25', created: true })
```

- [ ] **Step 2: Run the focused test to verify the missing seam**

Run: `pnpm exec vitest run tests/tools.spec.ts`

Expected: FAIL at typecheck or assertion because `ToolsConfig` does not yet accept `now` and the implementation still calls `new Date()` directly.

- [ ] **Step 3: Implement one clock source for the tool registrations**

Add the optional field and derive one function at registration time:

```ts
export interface ToolsConfig {
  vaultPath: string
  reportDir: string
  timeZone: string
  now?: () => Date
}

export function registerTools(ctx: Context, config: ToolsConfig): () => void {
  const now = config.now ?? (() => new Date())
  // Use dateKey(now(), config.timeZone) in kb_list_modified and kb_write_report.
}
```

Do not expose `now` in the user-facing `Config` schema. It is a deterministic dependency seam, not a deployment setting.

- [ ] **Step 4: Run the tool and full unit suites**

Run:

```sh
pnpm exec vitest run tests/tools.spec.ts
pnpm run test
```

Expected: both commands exit 0; no test asserts the machine's current calendar date.

- [ ] **Step 5: Document the timezone guarantee and commit**

Add one sentence to both READMEs: a report date is calculated from the configured IANA timezone at the instant the tool is executed. Then commit:

```sh
git add src/tools.ts tests/tools.spec.ts README.md README.zh.md
git commit -m "test: make kb report dates deterministic"
```

### Task 3: Enforce physical vault containment and bound report size

**Files:**

- Modify: `src/paths.ts`
- Modify: `src/fs.ts`
- Modify: `src/tools.ts`
- Modify: `tests/paths.spec.ts`
- Modify: `tests/fs.spec.ts`
- Modify: `tests/tools.spec.ts`
- Modify: `README.md`
- Modify: `README.zh.md`

**Interfaces:**

- `assertContained(vaultPath, relPath)` remains the lexical precondition.
- Add `assertNoSymlinkSegments(vaultPath, absolutePath): Promise<void>`; it rejects an existing symbolic-link component between the vault root and the target.
- Add `MAX_REPORT_BYTES = 512 * 1024` in `src/fs.ts` and reject report content whose UTF-8 byte length exceeds this safety bound.

- [ ] **Step 1: Add failing symbolic-link and oversized-report tests**

Add these cases. Use `try/catch` only to skip the symbolic-link assertion when Windows returns `EPERM`; do not hide any other error.

```ts
await writeFile(join(outside, 'secret.md'), 'outside')
await symlink(join(outside, 'secret.md'), join(vault, 'linked.md'), 'file')
await expect(readVaultFile(vault, 'linked.md')).rejects.toThrow(/symbolic link/i)
```

```ts
await symlink(outside, join(vault, 'Daily'), 'junction')
await expect(writeReport(vault, 'Daily', '2026-08-25.md', '# report')).rejects.toThrow(/symbolic link/i)
```

```ts
await expect(writeReport(vault, 'Daily', '2026-08-25.md', 'x'.repeat(512 * 1024 + 1)))
  .rejects.toThrow(/report exceeds 524288 bytes/i)
```

- [ ] **Step 2: Run the focused filesystem tests to verify they fail**

Run: `pnpm exec vitest run tests/paths.spec.ts tests/fs.spec.ts tests/tools.spec.ts`

Expected: the link tests expose the current lexical-only check and the report-size test writes the oversized file.

- [ ] **Step 3: Implement physical checks before any read or write**

In `src/paths.ts`, retain the current lexical check, then walk the relative path from the vault root with `lstat`. For each existing segment, throw `new Error('symbolic link is not allowed inside the vault: ' + segment)` when `stats.isSymbolicLink()` is true. A missing final segment is allowed only for report creation; missing intermediate segments are created only after all existing segments are checked.

In `src/fs.ts`:

```ts
export const MAX_REPORT_BYTES = 512 * 1024

if (Buffer.byteLength(content, 'utf8') > MAX_REPORT_BYTES) {
  throw new Error(`report exceeds ${MAX_REPORT_BYTES} bytes`)
}
```

Call the no-symlink check before `readFile`, before `mkdir`, and again after `mkdir` before `writeFile`. Preserve `{ flag: 'wx' }`; do not replace it with an overwrite mode.

In `src/tools.ts`, preserve the `write_failed` response shape when the size or link check rejects the write.

- [ ] **Step 4: Run the security regression suite**

Run:

```sh
pnpm exec vitest run tests/paths.spec.ts tests/fs.spec.ts tests/tools.spec.ts
pnpm run typecheck
```

Expected: all tests pass. On a Windows runner without link privileges, only the symlink cases are skipped with an explicit `EPERM` reason; Linux CI executes them.

- [ ] **Step 5: Align documentation and commit**

Remove the statement that escaping symlinks are out of scope. Document that the plugin rejects symbolic links in every path it reads or creates, preserves exclusive report creation, and rejects reports above 512 KiB. Then commit:

```sh
git add src/paths.ts src/fs.ts src/tools.ts tests/paths.spec.ts tests/fs.spec.ts tests/tools.spec.ts README.md README.zh.md
git commit -m "fix: enforce physical vault containment for kb reports"
```

### Task 4: Verify the packed artifact in a real DSH profile

**Files:**

- Create: `scripts/smoke-dsh.mjs`
- Create: `tests/packed-exports.spec.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Add the published CLI package `@deepseek-ai/dsh` at the same `0.1.0-rc.7` release train to `devDependencies`.
- `pnpm run smoke:dsh` consumes a tarball generated by `pnpm pack` and exits nonzero unless the profile contains the `kb-daily` bundle layer.

- [ ] **Step 1: Write the failing packed-export test**

Create `tests/packed-exports.spec.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('packed public exports', () => {
  it('does not advertise source files that are excluded from the tarball', async () => {
    const pkg = JSON.parse(await readFile(resolve(import.meta.dirname, '../package.json'), 'utf8'))
    expect(pkg.exports).not.toHaveProperty('./src/*')
    expect(pkg.exports['.'].default).toBe('./lib/index.js')
  })
})
```

- [ ] **Step 2: Run the test to verify the current broken export**

Run: `pnpm exec vitest run tests/packed-exports.spec.ts`

Expected: FAIL because `package.json` currently exposes `./src/*` while its `files` allowlist excludes `src/`.

- [ ] **Step 3: Add a tarball-to-profile smoke script**

Create `scripts/smoke-dsh.mjs` with these operations, in this order:

```js
// 1. Create a temporary directory and set DSH_HOME to <temp>/dsh-home.
// 2. Create <temp>/vault/Daily and write today's UTC report, so kb-daily never
//    dispatches an agent during the boot smoke test.
// 3. Run `pnpm pack --pack-destination <temp>/artifacts`.
// 4. Run `pnpm exec dsh plugin --profile smoke add <tarball>`.
// 5. Write $DSH_HOME/profiles/smoke/cordis.patch.yml containing the kb-daily
//    row with vaultPath, reportDir: Daily, timeZone: UTC, writePolicy: ask,
//    and checkIntervalMs: 3600000.
// 6. Run `pnpm exec dsh --profile smoke --dump-config`.
// 7. Assert stdout contains `# == @ly028716/dsh-kb-daily` and `id: kb-daily`.
// 8. Remove the temporary directory in a finally block.
```

Use `node:child_process` `execFileSync` with argument arrays, never shell interpolation. Calculate the pre-existing UTC report filename with `Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })` and normalize its parts to `YYYY-MM-DD`.

- [ ] **Step 4: Add the CLI dependency, fix exports, then run the smoke test**

Run:

```sh
pnpm add -D @deepseek-ai/dsh@0.1.0-rc.7
pnpm exec vitest run tests/packed-exports.spec.ts
pnpm run build
pnpm run smoke:dsh
```

Expected: the packed package activates a `kb-daily` layer in a new profile. The smoke test must not require an LLM key, agent adapter, or approval UI.

- [ ] **Step 5: Commit runtime-install proof**

```sh
git add package.json pnpm-lock.yaml scripts/smoke-dsh.mjs tests/packed-exports.spec.ts
git commit -m "test: smoke load packed kb daily bundle in DSH"
```

### Task 5: Add reproducible CI and release safety checks

**Files:**

- Create: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `README.zh.md`

**Interfaces:**

- `pnpm run verify` runs typecheck, unit tests, build, package inspection, and `smoke:dsh` in that order.
- CI tests Ubuntu because symbolic-link protection must run on a platform that supports symlink creation without Windows privilege policy.

- [ ] **Step 1: Add the aggregate verification script and make it fail before CI exists**

Add this script to `package.json`:

```json
"verify": "pnpm run typecheck && pnpm run test && pnpm run build && pnpm pack --dry-run && pnpm run smoke:dsh"
```

Run: `pnpm run verify`

Expected: it either passes after Tasks 1-4 or fails at the first incomplete task. Do not create a release while this command fails.

- [ ] **Step 2: Add the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - uses: pnpm/action-setup@v4
        with:
          version: 10.15.0
      - run: pnpm install --frozen-lockfile
      - run: pnpm run verify
```

Create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
```

- [ ] **Step 3: Validate the workflow syntax and local command**

Run:

```sh
pnpm run verify
git diff --check
```

Expected: both commands exit 0. Confirm GitHub Actions runs the same `verify` command before merging this task.

- [ ] **Step 4: Document version compatibility and commit**

Add a README compatibility table with the tested DSH release train `0.1.0-rc.7`, Node 22, pnpm 10.15.0, and the exact verification command. Then commit:

```sh
git add .github/workflows/ci.yml .github/dependabot.yml package.json README.md README.zh.md
git commit -m "ci: verify packaged DSH plugin on every change"
```

### Task 6: Prepare community-facing documentation and the release candidate

**Files:**

- Create: `docs/community-showcase.md`
- Create: `docs/assets/kb-daily-demo.gif`
- Modify: `README.md`
- Modify: `README.zh.md`

**Interfaces:**

- README supplies copy-paste installation using the actual package name and GitHub commit pin.
- `docs/community-showcase.md` supplies one community discussion post that follows the official title and disclosure rules.

- [ ] **Step 1: Add a precise installation and security section to both READMEs**

Document these two supported installs:

```sh
dsh plugin --profile daily add @ly028716/dsh-kb-daily
dsh plugin --profile daily add github:ly028716/dsh-kb-daily#<release-commit>
```

Document the required Git-install build approval:

```yaml
allowBuilds:
  '@ly028716/dsh-kb-daily': true
```

State that users should pin a commit for Git installs, use `writePolicy: ask` initially, and set an absolute vault path in `$DSH_HOME/profiles/daily/cordis.patch.yml`.

- [ ] **Step 2: Record an actual demo artifact**

Create `docs/assets/kb-daily-demo.gif` from one local profile run that visibly shows:

1. the profile configuration with `writePolicy: ask`;
2. `kb_list_modified` and `kb_read` returning vault-relative paths/content;
3. the host approval request for `kb_write_report`;
4. the created `Daily/YYYY-MM-DD.md` report; and
5. no overwrite on a second invocation.

Use a synthetic vault containing only non-sensitive sample Markdown. Do not record model credentials, local absolute user paths, approval tokens, or unrelated browser windows.

- [ ] **Step 3: Write the community submission document**

Create `docs/community-showcase.md` with this exact post structure:

```markdown
# DSH | KB Daily | Timezone-aware daily Markdown digests for knowledge bases

> 非官方项目，由社区成员独立开发和维护。

项目地址：https://github.com/ly028716/dsh-kb-daily

## 简介

KB Daily 是一个 DeepSeek Harness / Cordis 插件。它扫描指定 Markdown 知识库中当天变更的笔记，交给独立 agent 汇总，并只通过带审批的 `kb_write_report` 工具写入当天日报。

## 与 DSH 的集成方式

- 作为 `dsh.bundle` 通过 `dsh plugin --profile daily add ...` 安装。
- 注册 `agents`、`tools`、`systemPrompt`、`timer` 的公开 DSH 服务。
- `writePolicy: ask` 使用宿主 `tools/pre-execute` 审批；无审批通道时拒绝写入。
- 插件卸载时释放工具、提示词、监听器、定时器与专用 agent。

## 演示

![KB Daily approval and report creation](assets/kb-daily-demo.gif)
```

- [ ] **Step 4: Run the release candidate gate**

Run:

```sh
pnpm run verify
git status --short
git log -1 --oneline
```

Expected: verification exits 0, the working tree is clean, and the displayed commit is the intended release candidate.

- [ ] **Step 5: Create the release commit and publish only after approval**

```sh
git add README.md README.zh.md docs/community-showcase.md docs/assets/kb-daily-demo.gif
git commit -m "docs: prepare kb daily community release"
git tag v0.1.0
git push origin main --tags
```

After the tag is pushed, publish the built package to npm from the tagged checkout, then create a GitHub release whose release notes link to `docs/community-showcase.md`. Post the contents of that file in the official **Show Your Plugins!** category and add the repository topic `dsh-plugin`.

## Final Verification Checklist

- [ ] `pnpm install --frozen-lockfile` exits 0 on a clean Node 22 / pnpm 10.15.0 environment.
- [ ] `pnpm run verify` exits 0 locally and on Ubuntu GitHub Actions.
- [ ] `pnpm pack --dry-run` includes `lib/`, `cordis.patch.yml`, `LICENSE`, and READMEs; it excludes `src/`, tests, caches, and `node_modules`.
- [ ] A tarball installed with `dsh plugin --profile smoke add <tarball>` creates a `kb-daily` bundle layer in `dsh --profile smoke --dump-config`.
- [ ] A Git-pinned install builds via `prepare` after the explicit `allowBuilds` approval.
- [ ] All report dates are derived from an injected/frozen clock in tests and from configured IANA timezone at runtime.
- [ ] Reads and report writes reject lexical traversal and every existing symbolic-link segment.
- [ ] `writePolicy: ask` is covered by a host-approval regression test; `allow` is separately covered.
- [ ] The npm name, repository URL, issue URL, copyright file, and README all identify the same community-owned project.
- [ ] The community post uses the required `DSH | Project | Description` title, project URL, integration explanation, demo, and non-official disclosure.

## Rollback Boundaries

- Before npm publish: revert the release commits or fix forward; never overwrite an existing git tag.
- After npm publish: publish a new patch version; do not replace a published tarball.
- After a marketplace post: edit the post to point to the fixed release and pin the corrected commit in the GitHub installation command.
- If a security regression is found in path containment or approval handling: mark the affected release as deprecated on npm, create a GitHub security advisory if exposure is possible, and release a patched version before promoting it again.
