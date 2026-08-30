import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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

    const workflow = readFileSync(resolve(projectRoot, '.github/workflows/ci.yml'), 'utf8')
    expect(workflow).toContain('pnpm run verify:core')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('continue-on-error: true')
    expect(workflow).toContain('timeout-minutes: 5')
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch'")
    expect(workflow).not.toMatch(/^\s*- run: pnpm run verify\s*$/m)
  })
})
