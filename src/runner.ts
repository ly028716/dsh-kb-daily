import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/cordis-plugin-timer'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { dateKey, reportFileName } from './date.ts'
import { reportExists } from './fs.ts'
import { resolveReportPath } from './paths.ts'
import type { RunnerControl, RunnerStatus } from './status.ts'

export interface RunnerConfig {
  vaultPath: string
  reportDir: string
  timeZone: string
  agentId: string
  provider?: string
  model?: string
  checkIntervalMs: number
}

export interface RunOptions {
  now?: Date
  date?: string
  trackHandle?: (handle: AgentHandle) => void
}

export type CheckOutcome = 'ran' | 'already-done'

export type RunnerEvent = 'kb-daily.started' | 'kb-daily.skipped' | 'kb-daily.created' | 'kb-daily.failed' | 'kb-daily.approval-required'
type LogMethod = (message: unknown, ...params: unknown[]) => void
type LoggerLike = Partial<Record<'info' | 'warn' | 'error', LogMethod>>

/** Emit a structured, redacted lifecycle event when the host exposes logging. */
export function logRunnerEvent(ctx: Context, event: RunnerEvent, fields: Record<string, unknown>, level: 'info' | 'warn' | 'error' = 'info'): void {
  const service = (ctx as unknown as { logger?: unknown }).logger
  const logger = typeof service === 'function' ? service('kb-daily') as LoggerLike : service as LoggerLike | undefined
  const method = logger?.[level]
  if (typeof method === 'function') {
    try { method(event, fields) } catch { /* logging must not break the runner */ }
  }
}

function errorCategory(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code
  if (error instanceof Error && error.name) return error.name
  return 'unknown'
}

function notifyHost(ctx: Context, event: 'kb-daily.created' | 'kb-daily.failed', fields: Record<string, unknown>): void {
  const notification = (ctx as unknown as { notification?: unknown }).notification
  if (typeof notification !== 'object' || notification === null || !('send' in notification) || typeof notification.send !== 'function') return
  try {
    void (notification.send as (payload: unknown) => unknown)({ event, ...fields })
  } catch { /* optional notifications must not break the runner */ }
}

export async function runDailyCheck(ctx: Context, config: RunnerConfig, taskText: (date: string) => string, options: RunOptions = {}): Promise<CheckOutcome> {
  const date = options.date ?? dateKey(options.now ?? new Date(), config.timeZone)
  if (await reportExists(config.vaultPath, config.reportDir, reportFileName(date))) return 'already-done'
  const id = SessionId(config.agentId)
  const agentOptions = {
    ...(config.provider === undefined ? {} : { provider: config.provider }),
    ...(config.model === undefined ? {} : { model: config.model }),
  }
  const existing = ctx.agents.get(id)
  let agent = existing
  if (agent === undefined) {
    let handle: AgentHandle
    try {
      handle = await ctx.agents.resume({ resumeSessionId: id, agentOptions })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const message = error instanceof Error ? error.message : String(error)
      const resumable = code === 'ENOENT' || code === 'ENOTDIR' || code === 'SESSION_NOT_FOUND' ||
        code === 'PERSISTENCE_UNAVAILABLE' || /no persistence|session does not exist|not found|persistence unavailable/i.test(message)
      if (!resumable) throw error
      handle = await ctx.agents.create({ sessionId: id, agentOptions })
    }
    options.trackHandle?.(handle)
    agent = handle.agent
  }
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: taskText(date) }],
    source: { kind: 'plugin', plugin: 'kb-daily' },
  }))
  return 'ran'
}

export interface GuardDeps {
  now: () => Date
  timeZone: string
  reportExists: (date: string) => Promise<boolean>
  run: () => Promise<void>
}

/** Guard against duplicate same-day and overlapping checks. */
export function createGuard(deps: GuardDeps): () => Promise<void> {
  let attemptedDay: string | undefined
  let inFlight = false
  return async () => {
    if (inFlight) return
    const day = dateKey(deps.now(), deps.timeZone)
    if (attemptedDay === day) return
    inFlight = true
    try {
      if (await deps.reportExists(day)) return
      attemptedDay = day
      await deps.run()
    } finally {
      inFlight = false
    }
  }
}

/** Create explicit controls plus lifecycle cleanup for the daily runner. */
export function createRunner(ctx: Context, config: RunnerConfig, taskText: (date: string) => string): { control: RunnerControl; stop: () => Promise<void> } {
  const handles = new Set<AgentHandle>()
  const activeRuns = new Set<Promise<void>>()
  let inFlight: Promise<CheckOutcome> | undefined
  let attemptedDay: string | undefined
  let stopped = false
  let currentStatus: RunnerStatus = {
    date: dateKey(new Date(), config.timeZone),
    state: 'idle',
  }

  const run = async (targetDate: string, force: boolean): Promise<CheckOutcome> => {
    if (stopped) throw new Error('kb-daily runner is stopped')
    if (inFlight !== undefined) return inFlight
    const startingStatus = { ...currentStatus, date: targetDate, state: 'running' as const, lastAttemptAt: new Date().toISOString() }
    delete startingStatus.lastError
    currentStatus = startingStatus
    const startedAt = Date.now()
    logRunnerEvent(ctx, 'kb-daily.started', { date: targetDate, fileCount: null, status: 'running' })
    inFlight = (async () => {
      const destination = resolveReportPath(config.vaultPath, config.reportDir, reportFileName(targetDate))
      if (!force && attemptedDay === targetDate) {
        currentStatus = { ...currentStatus, state: 'already-done', reportPath: destination }
        logRunnerEvent(ctx, 'kb-daily.skipped', { date: targetDate, fileCount: null, durationMs: Date.now() - startedAt, status: 'already-done' })
        return 'already-done'
      }
      if (await reportExists(config.vaultPath, config.reportDir, reportFileName(targetDate))) {
        attemptedDay = targetDate
        currentStatus = { ...currentStatus, state: 'already-done', reportPath: destination }
        logRunnerEvent(ctx, 'kb-daily.skipped', { date: targetDate, fileCount: null, durationMs: Date.now() - startedAt, status: 'already-done' })
        return 'already-done'
      }
      attemptedDay = targetDate
      const outcome = await runDailyCheck(ctx, config, taskText, {
        date: targetDate,
        trackHandle: handle => handles.add(handle),
      })
      currentStatus = { ...currentStatus, state: 'succeeded', reportPath: destination }
      logRunnerEvent(ctx, 'kb-daily.created', { date: targetDate, fileCount: null, durationMs: Date.now() - startedAt, status: outcome })
      notifyHost(ctx, 'kb-daily.created', { date: targetDate, status: outcome })
      return outcome
    })().catch(error => {
      currentStatus = { ...currentStatus, state: 'failed', lastError: error instanceof Error ? error.message : String(error) }
      const fields = { date: targetDate, fileCount: null, durationMs: Date.now() - startedAt, status: 'failed', errorCategory: errorCategory(error) }
      logRunnerEvent(ctx, 'kb-daily.failed', fields, 'error')
      notifyHost(ctx, 'kb-daily.failed', fields)
      throw error
    }).finally(() => { inFlight = undefined })
    return inFlight
  }

  const runNow = (): Promise<CheckOutcome> => {
    const targetDate = dateKey(new Date(), config.timeZone)
    const promise = run(targetDate, false)
    const tracked = promise.then(() => undefined, () => undefined)
    activeRuns.add(tracked)
    void tracked.then(() => activeRuns.delete(tracked))
    return promise
  }
  const retry = (date?: string): Promise<CheckOutcome> => {
    const targetDate = date ?? dateKey(new Date(), config.timeZone)
    const promise = run(targetDate, true)
    const tracked = promise.then(() => undefined, () => undefined)
    activeRuns.add(tracked)
    void tracked.then(() => activeRuns.delete(tracked))
    return promise
  }
  const control: RunnerControl = {
    runNow,
    retry,
    status: () => ({ ...currentStatus }),
  }
  const invoke = () => { void runNow().catch(() => undefined) }
  invoke()
  const stopTimer = ctx.interval(invoke, config.checkIntervalMs)
  const stop = async () => {
    if (stopped) return
    stopped = true
    stopTimer()
    await Promise.allSettled([...activeRuns])
    await Promise.allSettled([...handles].map(handle => handle.dispose()))
    currentStatus = { ...currentStatus, state: 'stopped' }
  }
  return { control, stop }
}

/** Start the immediate and interval-based catch-up checks. */
export function startRunner(ctx: Context, config: RunnerConfig, taskText: (date: string) => string): () => Promise<void> {
  return createRunner(ctx, config, taskText).stop
}
