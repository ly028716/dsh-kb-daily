import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createGuard, createRunner, runDailyCheck, startRunner } from '../src/runner.ts'
import { dateKey } from '../src/date.ts'

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

  it('falls back to create when session persistence is not configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-runner-fallback-'))
    const followup = vi.fn()
    const agents = {
      get: vi.fn(() => undefined),
      resume: vi.fn(async () => { throw new Error('cannot resume: session persistence is not configured (load a dsh-session-persistence backend)') }),
      create: vi.fn(async () => ({
        agent: {
          followup: () => {
            mkdirSync(join(root, 'Daily'), { recursive: true })
            writeFileSync(join(root, 'Daily', '2026-08-24.md'), '# report')
            followup()
          },
          whenIdle: async () => undefined,
        },
        dispose: vi.fn(),
      })),
    }
    const ctx = { agents } as never
    try {
      await runDailyCheck(ctx, {
        vaultPath: root, reportDir: 'Daily', timeZone: 'UTC', agentId: 'kb-daily',
        checkIntervalMs: 1000,
      }, date => `run ${date}`, {
        now: new Date('2026-08-24T10:00:00Z'),
      })
      expect(agents.resume).toHaveBeenCalledOnce()
      expect(agents.create).toHaveBeenCalledOnce()
      expect(followup).toHaveBeenCalledOnce()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('waits for the agent to become idle and the report to exist before succeeding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-runner-completion-'))
    try {
      let releaseIdle!: () => void
      const idle = new Promise<void>(resolve => { releaseIdle = resolve })
      const followup = vi.fn()
      const agents = {
        get: vi.fn(() => undefined),
        resume: vi.fn(async () => { throw new Error('no persistence') }),
        create: vi.fn(async () => ({ agent: { followup, whenIdle: () => idle }, dispose: vi.fn() })),
      }
      const ctx = { agents } as never
      const run = runDailyCheck(ctx, {
        vaultPath: root, reportDir: 'Daily', timeZone: 'UTC', agentId: 'kb-daily',
        checkIntervalMs: 1000,
      }, date => `run ${date}`, {
        now: new Date('2026-08-24T10:00:00Z'),
      })

      await vi.waitFor(() => expect(followup).toHaveBeenCalledOnce())
      let settled = false
      void run.then(() => { settled = true })
      await Promise.resolve()
      expect(settled).toBe(false)

      await mkdir(join(root, 'Daily'), { recursive: true })
      await writeFile(join(root, 'Daily', '2026-08-24.md'), '# report')
      releaseIdle()

      await expect(run).resolves.toBe('ran')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails when the agent becomes idle without creating the report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-runner-failure-'))
    try {
      const agents = {
        get: vi.fn(() => undefined),
        resume: vi.fn(async () => { throw new Error('no persistence') }),
        create: vi.fn(async () => ({
          agent: { followup: vi.fn(), whenIdle: async () => undefined },
          dispose: vi.fn(),
        })),
      }
      const ctx = { agents } as never

      await expect(runDailyCheck(ctx, {
        vaultPath: root, reportDir: 'Daily', timeZone: 'UTC', agentId: 'kb-daily',
        checkIntervalMs: 1000,
      }, date => `run ${date}`, {
        now: new Date('2026-08-24T10:00:00Z'),
      })).rejects.toThrow(/without creating the report/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('marks the runner failed and does not emit created when report creation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-runner-failure-state-'))
    try {
      const info = vi.fn()
      const error = vi.fn()
      const agents = {
        get: vi.fn(() => undefined),
        resume: vi.fn(async () => { throw new Error('no persistence') }),
        create: vi.fn(async () => ({
          agent: { followup: vi.fn(), whenIdle: vi.fn(async () => undefined) },
          dispose: vi.fn(),
        })),
      }
      const ctx = { agents, logger: { info, error }, interval: vi.fn(() => vi.fn()) } as never
      const runner = createRunner(ctx, {
        vaultPath: root, reportDir: 'Daily', timeZone: 'UTC', agentId: 'kb-daily', checkIntervalMs: 1000,
      }, () => 'run')

      await vi.waitFor(() => expect(runner.control.status().state).toBe('failed'))
      expect(runner.control.status().lastError).toMatch(/without creating the report/i)
      expect(info).not.toHaveBeenCalledWith('kb-daily.created', expect.anything())
      expect(error).toHaveBeenCalledWith('kb-daily.failed', expect.objectContaining({ status: 'failed' }))
      await runner.stop()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('exposes status, explicit retry, and report protection through RunnerControl', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-runner-control-'))
    try {
      const handles = [
        {
          agent: {
            followup: vi.fn(() => { mkdirSync(join(root, 'Daily'), { recursive: true }); writeFileSync(join(root, 'Daily', `${dateKey(new Date(), 'UTC')}.md`), '# report') }),
            whenIdle: vi.fn(async () => undefined),
          },
          dispose: vi.fn(async () => undefined),
        },
        {
          agent: {
            followup: vi.fn(() => { mkdirSync(join(root, 'Daily'), { recursive: true }); writeFileSync(join(root, 'Daily', '2026-08-24.md'), '# report') }),
            whenIdle: vi.fn(async () => undefined),
          },
          dispose: vi.fn(async () => undefined),
        },
      ]
      const agents = {
        get: vi.fn(() => undefined),
        resume: vi.fn(async () => { throw new Error('no persistence') }),
        create: vi.fn(async () => handles.shift()!),
      }
      const ctx = { agents, interval: vi.fn(() => vi.fn()) } as never
      const runner = createRunner(ctx, {
        vaultPath: root, reportDir: 'Daily', timeZone: 'UTC', agentId: 'kb-daily', checkIntervalMs: 1000,
      }, date => `run ${date}`)
      await vi.waitFor(() => expect(agents.create).toHaveBeenCalledOnce())
      expect(runner.control.status().state).toBe('succeeded')
      expect(await runner.control.runNow()).toBe('already-done')
      expect(await runner.control.retry('2026-08-24')).toBe('ran')
      expect(runner.control.status()).toMatchObject({ date: '2026-08-24', state: 'succeeded', reportPath: join(root, 'Daily', '2026-08-24.md') })
      await runner.stop()
      expect(runner.control.status().state).toBe('stopped')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not turn fatal resume errors into fresh agent creation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-runner-failure-'))
    try {
      const agents = {
        get: vi.fn(() => undefined),
        resume: vi.fn(async () => { throw new Error('provider is unavailable') }),
        create: vi.fn(async () => ({ agent: { followup: vi.fn(), whenIdle: vi.fn(async () => undefined) }, dispose: vi.fn() })),
      }
      const ctx = { agents, interval: vi.fn(() => vi.fn()) } as never
      const runner = createRunner(ctx, {
        vaultPath: root, reportDir: 'Daily', timeZone: 'UTC', agentId: 'kb-daily', checkIntervalMs: 1000,
      }, () => 'run')
      await vi.waitFor(() => expect(runner.control.status().state).toBe('failed'))
      expect(agents.create).not.toHaveBeenCalled()
      expect(runner.control.status().lastError).toContain('provider is unavailable')
      await runner.stop()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('emits fixed lifecycle events with redacted operational fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-runner-log-'))
    try {
      const info = vi.fn()
      const agents = {
        get: vi.fn(() => undefined),
        resume: vi.fn(async () => { throw new Error('no persistence') }),
        create: vi.fn(async () => ({
          agent: {
            followup: vi.fn(() => { mkdirSync(join(root, 'Daily'), { recursive: true }); writeFileSync(join(root, 'Daily', `${dateKey(new Date(), 'UTC')}.md`), '# report') }),
            whenIdle: vi.fn(async () => undefined),
          },
          dispose: vi.fn(),
        })),
      }
      const ctx = { agents, logger: { info }, interval: vi.fn(() => vi.fn()) } as never
      const runner = createRunner(ctx, {
        vaultPath: root, reportDir: 'Daily', timeZone: 'UTC', agentId: 'kb-daily', checkIntervalMs: 1000,
      }, () => 'run')
      await vi.waitFor(() => expect(info).toHaveBeenCalledWith('kb-daily.created', expect.objectContaining({ status: 'ran', fileCount: null })))
      expect(info).toHaveBeenCalledWith('kb-daily.started', expect.objectContaining({ status: 'running' }))
      const serialized = JSON.stringify(info.mock.calls)
      expect(serialized).not.toContain(root)
      expect(serialized).not.toContain('no persistence')
      await runner.stop()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('disposes created agent handles when a runner is stopped and restarted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-runner-'))
    try {
      const handles = [
        { agent: { followup: vi.fn(), whenIdle: vi.fn(async () => undefined) }, dispose: vi.fn(async () => undefined) },
        { agent: { followup: vi.fn(), whenIdle: vi.fn(async () => undefined) }, dispose: vi.fn(async () => undefined) },
      ]
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
