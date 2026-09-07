import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workflow = parse(readFileSync(resolve(repositoryRoot, '.github/workflows/ci.yml'), 'utf8'))

describe('CI release gate', () => {
  it('runs the real DSH smoke job as a blocking job for normal CI events', () => {
    const smoke = workflow.jobs.smoke

    expect(workflow.on.push.branches).toEqual(['main'])
    expect(workflow.on.pull_request).toBeNull()
    expect(workflow.on.workflow_dispatch).toBeNull()
    expect(workflow.jobs['verify-core']).toBeDefined()
    expect(smoke.if).toBeUndefined()
    expect(smoke['continue-on-error']).toBeUndefined()
    expect(smoke.needs).toBe('verify-core')
    expect(smoke['timeout-minutes']).toBe(5)
    expect(smoke.steps).toContainEqual({ run: 'pnpm run smoke:dsh' })
  })
})
