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

function readText(relativePath: string): string {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

describe('community bundle package contract', () => {
  it('declares the published community package identity and patch manifest', () => {
    const pkg = readJson<PackageJson>('package.json')
    const patchText = readText('cordis.patch.yml')

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
    expect(patchText).toBe([
      '- insert:',
      '    - id: kb-daily',
      "      name: '@ly028716/dsh-kb-daily'",
      '',
    ].join('\n'))
  })

  it('ships the MIT license text for the community package', () => {
    const licenseText = readText('LICENSE')

    expect(existsSync(resolve(projectRoot, 'LICENSE'))).toBe(true)
    expect(licenseText).toBe([
      'MIT License',
      '',
      'Copyright (c) 2026 ly028716',
      '',
      'Permission is hereby granted, free of charge, to any person obtaining a copy',
      'of this software and associated documentation files (the "Software"), to deal',
      'in the Software without restriction, including without limitation the rights',
      'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
      'copies of the Software, and to permit persons to whom the Software is',
      'furnished to do so, subject to the following conditions:',
      '',
      'The above copyright notice and this permission notice shall be included in all',
      'copies or substantial portions of the Software.',
      '',
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
      'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
      'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
      'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
      'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
      'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
      'SOFTWARE.',
      '',
    ].join('\n'))
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
