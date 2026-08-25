import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createGuard, runDailyCheck, startRunner } from '../src/runner.ts'

describe('kb-daily runner', () => {
  it('prevents duplicate same-day work and concurrent runs', async () => {
    let resolveRun!: () => void
    const run = vi.fn(() => new Promise<void>(resolve => { resolveRun = resolve }))
    const check = createGuard({
      now: () => new Date('2026-08-24T10:00:00Z'),
      timeZone: 'UTC',
      reportExists: vi.fn(async () => false),
      run,
    })
    const first = check()
    const second = check()
    await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(1)
    resolveRun()
    await first
    await second
    await check()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('resumes a persisted agent and falls back to create', async () => {
    const followup = vi.fn()
    const agents = {
      get: vi.fn(() => undefined),
      resume: vi.fn(async () => { throw new Error('no persistence') }),
      create: vi.fn(async () => ({ agent: { followup }, dispose: vi.fn() })),
    }
    const ctx = { agents } as never
    await runDailyCheck(ctx, {
      vaultPath: 'C:/vault', reportDir: 'Daily', timeZone: 'UTC', agentId: 'kb-daily',
      checkIntervalMs: 1000,
    }, date => `run ${date}`, {
      now: new Date('2026-08-24T10:00:00Z'),
    })
    expect(agents.resume).toHaveBeenCalledOnce()
    expect(agents.create).toHaveBeenCalledOnce()
    expect(followup).toHaveBeenCalledOnce()
  })

  it('disposes created agent handles when a runner is stopped and restarted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-runner-'))
    try {
      const handles = [{ agent: { followup: vi.fn() }, dispose: vi.fn(async () => undefined) }, { agent: { followup: vi.fn() }, dispose: vi.fn(async () => undefined) }]
      const created = handles.slice()
      const agents = {
        get: vi.fn(() => undefined),
        resume: vi.fn(async () => { throw new Error('no persistence') }),
        create: vi.fn(async () => handles.shift()!),
      }
      const ctx = { agents, interval: vi.fn(() => vi.fn()) } as never
      const config = { vaultPath: root, reportDir: 'Daily', timeZone: 'UTC', agentId: 'kb-daily', checkIntervalMs: 1000 }
      const stopFirst = startRunner(ctx, config, () => 'first')
      await vi.waitFor(() => expect(agents.create).toHaveBeenCalledOnce())
      await stopFirst()
      expect(created[0]!.dispose).toHaveBeenCalledOnce()
      expect(handles).toHaveLength(1)

      const stopSecond = startRunner(ctx, config, () => 'second')
      await vi.waitFor(() => expect(agents.create).toHaveBeenCalledTimes(2))
      await stopSecond()
      expect(created[1]!.dispose).toHaveBeenCalledOnce()
      expect(handles).toHaveLength(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
