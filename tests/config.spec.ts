import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')

describe('release configuration gate', () => {
  it('parses the CI, Dependabot, and pnpm workspace configuration files', () => {
    const output = execFileSync(
      process.execPath,
      [resolve(projectRoot, 'scripts/parse-config.mjs')],
      { cwd: projectRoot, encoding: 'utf8' },
    )

    expect(output).toContain('.github/workflows/ci.yml: ok')
    expect(output).toContain('.github/dependabot.yml: ok')
    expect(output).toContain('pnpm-workspace.yaml: ok')
  })
})
