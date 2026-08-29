import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(testDir, '..')

type PackageJson = {
  name?: string
  homepage?: string
  bugs?: string | { url?: string }
  repository?: { type?: string; url?: string }
  exports?: Record<string, unknown>
  files?: string[]
  scripts?: Record<string, string>
  dsh?: {
    bundle?: {
      patch?: string
    }
  }
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(projectRoot, relativePath), 'utf8')) as T
}

describe('community bundle package contract', () => {
  it('declares the published community package identity and patch manifest', () => {
    const pkg = readJson<PackageJson>('package.json')

    expect(pkg.name).toBe('@ly028716/dsh-kb-daily')
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/ly028716/dsh-kb-daily.git',
    })
    expect(pkg.homepage).toBe('https://github.com/ly028716/dsh-kb-daily#readme')
    expect(pkg.bugs).toEqual({
      url: 'https://github.com/ly028716/dsh-kb-daily/issues',
    })
    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(existsSync(resolve(projectRoot, 'cordis.patch.yml'))).toBe(true)
    expect(existsSync(resolve(projectRoot, 'LICENSE'))).toBe(true)
  })

  it('only exports packaged entrypoints and builds lib before packing', () => {
    const pkg = readJson<PackageJson>('package.json')

    expect(pkg.exports).toEqual({
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
    expect(pkg.files).toEqual(expect.arrayContaining([
      'lib/**/*.js',
      'lib/**/*.d.ts',
      'lib/**/*.js.map',
      'lib/**/*.d.ts.map',
      'README.md',
      'README.zh.md',
      'README.i18n.yaml',
      'cordis.patch.yml',
      'LICENSE',
      'package.json',
    ]))
    expect(pkg.scripts?.prepare ?? pkg.scripts?.prepack).toBe('pnpm run build')
  })
})
