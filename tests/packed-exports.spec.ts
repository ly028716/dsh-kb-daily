import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(testDir, '..')

type PackedBundle = {
  extractDir: string
  entries: string[]
  packageDir: string
  packageJson: {
    exports?: Record<string, unknown>
    scripts?: Record<string, string>
    devDependencies?: Record<string, string>
  }
}

function runCommand(command: string, args: string[], cwd: string): string {
  const invocation = process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')
    ? { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', command, ...args] }
    : { command, args }

  return execFileSync(invocation.command, invocation.args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function pnpmCommand(): string {
  return process.platform === 'win32' ? 'pnpm.CMD' : 'pnpm'
}

function packArtifact(): PackedBundle {
  const tempRoot = mkdtempSync(join(tmpdir(), 'kb-daily-pack-'))
  const artifactDir = join(tempRoot, 'artifacts')
  const extractDir = join(tempRoot, 'extract')

  try {
    mkdirSync(artifactDir, { recursive: true })
    mkdirSync(extractDir, { recursive: true })
    runCommand(pnpmCommand(), ['pack', '--pack-destination', artifactDir], projectRoot)
    const [tarball] = readdirSync(artifactDir)
    const tarballPath = join(artifactDir, tarball)
    const entries = runCommand('tar', ['-tf', tarballPath], projectRoot)
      .split(/\r?\n/)
      .filter(Boolean)
      .sort()

    runCommand('tar', ['-xzf', tarballPath, '-C', extractDir], projectRoot)
    const packageDir = join(extractDir, 'package')
    const packageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as PackedBundle['packageJson']

    return { extractDir: tempRoot, entries, packageDir, packageJson }
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true })
    throw error
  }
}

function assertPackedResolution(packageDir: string): void {
  const consumerRoot = mkdtempSync(join(tmpdir(), 'kb-daily-consumer-'))
  try {
    const scopedDir = join(consumerRoot, 'node_modules', '@ly028716')
    mkdirSync(scopedDir, { recursive: true })
    cpSync(packageDir, join(scopedDir, 'dsh-kb-daily'), { recursive: true })

    const importScript = [
      "import { createRequire } from 'node:module'",
      "const require = createRequire(import.meta.url)",
      "require.resolve('@ly028716/dsh-kb-daily')",
      "require.resolve('@ly028716/dsh-kb-daily/invariant')",
    ].join('\n')

    runCommand(process.execPath, ['--input-type=module', '--eval', importScript], consumerRoot)

    expect(() => runCommand(
      process.execPath,
      ['--input-type=module', '--eval', "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); require.resolve('@ly028716/dsh-kb-daily/src/index.ts')"],
      consumerRoot,
    )).toThrow(/ERR_PACKAGE_PATH_NOT_EXPORTED|Cannot find module|Package subpath/i)
  } finally {
    rmSync(consumerRoot, { recursive: true, force: true })
  }
}

describe('packed artifact contract', () => {
  it('ships the required published files and excludes source, tests, caches, node_modules, and nested tarballs', () => {
    const packed = packArtifact()
    try {
      expect(packed.entries).toEqual(expect.arrayContaining([
        'package/package.json',
        'package/README.md',
        'package/README.zh.md',
        'package/README.i18n.yaml',
        'package/cordis.patch.yml',
        'package/LICENSE',
        'package/lib/index.js',
        'package/lib/index.d.ts',
        'package/lib/invariant.js',
        'package/lib/invariant.d.ts',
      ]))

      const forbiddenEntry = packed.entries.find(entry =>
        /(^|\/)(src|tests|__tests__|node_modules|coverage|dist|tmp|temp|cache|\.pnpm-store)(\/|$)|\.tsbuildinfo$|\.tgz$/i.test(entry),
      )

      expect(forbiddenEntry).toBeUndefined()
    } finally {
      rmSync(packed.extractDir, { recursive: true, force: true })
    }
  })

  it('defines release verification scripts and exposes only packaged entrypoints from the tarball', () => {
    const packed = packArtifact()
    try {
      expect(packed.packageJson.scripts).toMatchObject({
        test: 'vitest run --exclude tests/packed-exports.spec.ts',
        'pack:inspect': 'vitest run tests/packed-exports.spec.ts',
        'smoke:dsh': 'node scripts/smoke-dsh.mjs',
        verify: 'pnpm run typecheck && pnpm run test && pnpm run build && pnpm run pack:inspect && pnpm run smoke:dsh',
      })
      expect(packed.packageJson.devDependencies?.['@deepseek-ai/dsh']).toBeDefined()
      expect(packed.packageJson.exports).toEqual({
        '.': {
          types: './lib/index.d.ts',
          default: './lib/index.js',
        },
        './invariant': {
          types: './lib/invariant.d.ts',
          default: './lib/invariant.js',
        },
        './package.json': './package.json',
      })
      expect(existsSync(join(packed.packageDir, 'src'))).toBe(false)

      assertPackedResolution(packed.packageDir)
    } finally {
      rmSync(packed.extractDir, { recursive: true, force: true })
    }
  })
})
