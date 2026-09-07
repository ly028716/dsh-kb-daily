import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/cordis-plugin-timer'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { dateKey, reportFileName } from './date.ts'
import { reportExists } from './fs.ts'
import { resolveReportPath } from './paths.ts'
import type { RunDiagnostics, RunnerControl, RunnerStatus, ToolCallSummary } from './status.ts'

export interface RunnerConfig {
  vaultPath: string
  reportDir: string
  timeZone: string
  agentId: string
  provider?: string
  model?: string
  checkIntervalMs: number
  toolNames?: readonly string[]
  readToolName?: string
}

export interface RunOptions {
  now?: Date
  date?: string
  trackHandle?: (handle: AgentHandle) => void
}

export type CheckOutcome = 'ran' | 'already-done'

export type RunnerEvent = 'kb-daily.started' | 'kb-daily.skipped' | 'kb-daily.created' | 'kb-daily.failed' | 'kb-daily.approval-required' | 'kb-daily.approval-rejected' | 'kb-daily.approval-timeout'
export type ApprovalStatusUpdate =
  | { state: 'awaiting-approval' }
  | { state: 'approved' }
  | { state: 'rejected'; reason: string }
  | { state: 'timed-out'; reason: string }
  | { state: 'unavailable'; reason: string }
type LogMethod = (message: unknown, ...params: unknown[]) => void
type LoggerLike = Partial<Record<'info' | 'warn' | 'error', LogMethod>>
interface MutableDiagnostics {
  filesRead: number
  truncationCount: number
  toolCalls: Map<string, ToolCallSummary>
}

function createDiagnostics(): MutableDiagnostics {
  return { filesRead: 0, truncationCount: 0, toolCalls: new Map() }
}

function snapshotDiagnostics(diagnostics: MutableDiagnostics, durationMs: number): RunDiagnostics {
  const toolCalls: Record<string, ToolCallSummary> = {}
  for (const name of [...diagnostics.toolCalls.keys()].sort()) {
    const summary = diagnostics.toolCalls.get(name)
    if (summary !== undefined) toolCalls[name] = { ...summary }
  }
  return {
    durationMs,
    filesRead: diagnostics.filesRead,
    truncationCount: diagnostics.truncationCount,
    toolCalls,
  }
}

function redactDiagnosticText(error: unknown, vaultPath: string): string {
  const message = error instanceof Error ? error.message : String(error)
  const redacted = vaultPath.length === 0 ? message : message.split(vaultPath).join('<vault>')
  return redacted.length > 512 ? `${redacted.slice(0, 509)}...` : redacted
}

/** Emit a structured, redacted lifecycle event when the host exposes logging. */
export function logRunnerEvent(ctx: Context, event: RunnerEvent, fields: Record<string, unknown>, level: 'info' | 'warn' | 'error' = 'info'): void {
  const service = (ctx as unknown as { logger?: unknown }).logger
  let logger: LoggerLike | undefined
  try {
    logger = typeof service === 'function' ? service('kb-daily') as LoggerLike : service as LoggerLike | undefined
  } catch { return }
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
  try {
    const notification = (ctx as unknown as { notification?: unknown }).notification
    if (typeof notification !== 'object' || notification === null || !('send' in notification) || typeof notification.send !== 'function') return
    Promise.resolve((notification.send as (payload: unknown) => unknown)({ event, ...fields })).catch(() => undefined)
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
        code === 'PERSISTENCE_UNAVAILABLE' || /no persistence|session persistence is not configured|session does not exist|not found|persistence unavailable/i.test(message)
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

  // followup() only confirms that the message was queued. Wait for the
  // agent's driver to quiesce, then verify that this run produced its report
  // before allowing callers to mark the run as successful.
  await agent.whenIdle()
  if (!await reportExists(config.vaultPath, config.reportDir, reportFileName(date))) {
    throw new Error(`kb-daily agent completed without creating the report for ${date}`)
  }
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
export function createRunner(ctx: Context, config: RunnerConfig, taskText: (date: string) => string): { control: RunnerControl; updateApprovalStatus: (update: ApprovalStatusUpdate) => void; stop: () => Promise<void> } {
  const handles = new Set<AgentHandle>()
  const activeRuns = new Set<Promise<void>>()
  let inFlight: Promise<CheckOutcome> | undefined
  let attemptedDay: string | undefined
  let stopped = false
  let approvalUnavailable = false
  let runStartedAt: number | undefined
  let diagnostics = createDiagnostics()
  const diagnosticToolNames = new Set(config.toolNames ?? [])
  const observeToolResult = (exec: { name: string }, result: { isError: boolean; value?: unknown }): void => {
    if (stopped || inFlight === undefined || !diagnosticToolNames.has(exec.name)) return
    const value = result.value
    const valueRecord = typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
    const toolFailed = result.isError || typeof valueRecord?.code === 'string' && valueRecord.code !== 'report_exists'
    const previous = diagnostics.toolCalls.get(exec.name) ?? { count: 0, failures: 0 }
    diagnostics.toolCalls.set(exec.name, {
      count: previous.count + 1,
      failures: previous.failures + (toolFailed ? 1 : 0),
    })
    if (toolFailed) return
    if (exec.name === config.readToolName && typeof valueRecord?.content === 'string') diagnostics.filesRead += 1
    if (valueRecord?.truncated === true) {
      diagnostics.truncationCount += 1
    }
  }
  let disposeToolObserver = (): void => undefined
  const contextOn = (ctx as unknown as { on?: unknown }).on
  if (typeof contextOn === 'function') {
    try {
      disposeToolObserver = (contextOn as (name: string, callback: typeof observeToolResult) => () => void).call(ctx, 'tools/result', observeToolResult)
    } catch { /* lightweight test contexts may omit the tools event surface */ }
  }

  const diagnosticFields = (durationMs: number): Record<string, unknown> => {
    const snapshot = snapshotDiagnostics(diagnostics, durationMs)
    return {
      durationMs: snapshot.durationMs,
      filesRead: snapshot.filesRead,
      truncationCount: snapshot.truncationCount,
      toolCalls: snapshot.toolCalls,
    }
  }
  let currentStatus: RunnerStatus = {
    date: dateKey(new Date(), config.timeZone),
    state: 'idle',
  }

  const updateApprovalStatus = (update: ApprovalStatusUpdate): void => {
    if (stopped || inFlight === undefined) return
    if (update.state === 'awaiting-approval') {
      currentStatus = { ...currentStatus, state: 'awaiting-approval' }
      return
    }
    if (update.state === 'approved') {
      if (currentStatus.state === 'awaiting-approval') currentStatus = { ...currentStatus, state: 'running' }
      return
    }
    if (update.state === 'unavailable') {
      approvalUnavailable = true
      const reason = redactDiagnosticText(update.reason, config.vaultPath)
      currentStatus = {
        ...currentStatus,
        state: 'failed',
        lastError: reason,
        ...(runStartedAt === undefined ? {} : { diagnostics: snapshotDiagnostics(diagnostics, Date.now() - runStartedAt) }),
      }
      return
    }
    const reason = redactDiagnosticText(update.reason, config.vaultPath)
    currentStatus = {
      ...currentStatus,
      state: update.state,
      lastError: reason,
      ...(runStartedAt === undefined ? {} : { diagnostics: snapshotDiagnostics(diagnostics, Date.now() - runStartedAt) }),
    }
    const event = update.state === 'rejected' ? 'kb-daily.approval-rejected' : 'kb-daily.approval-timeout'
    logRunnerEvent(ctx, event, {
      date: currentStatus.date,
      fileCount: null,
      status: update.state,
      errorCategory: update.state === 'rejected' ? 'approval_rejected' : 'approval_timeout',
      failureReason: reason,
      ...(runStartedAt === undefined ? {} : diagnosticFields(Date.now() - runStartedAt)),
    }, 'warn')
  }

  const run = async (targetDate: string, force: boolean): Promise<CheckOutcome> => {
    if (stopped) throw new Error('kb-daily runner is stopped')
    if (inFlight !== undefined) return inFlight
    runStartedAt = Date.now()
    diagnostics = createDiagnostics()
    approvalUnavailable = false
    const startingStatus = { ...currentStatus, date: targetDate, state: 'running' as const, lastAttemptAt: new Date().toISOString() }
    delete startingStatus.lastError
    startingStatus.diagnostics = snapshotDiagnostics(diagnostics, 0)
    currentStatus = startingStatus
    const startedAt = runStartedAt
    logRunnerEvent(ctx, 'kb-daily.started', { date: targetDate, fileCount: null, status: 'running', ...diagnosticFields(0) })
    inFlight = (async () => {
      const destination = resolveReportPath(config.vaultPath, config.reportDir, reportFileName(targetDate))
      if (!force && attemptedDay === targetDate) {
        const durationMs = Date.now() - startedAt
        currentStatus = { ...currentStatus, state: 'already-done', reportPath: destination, diagnostics: snapshotDiagnostics(diagnostics, durationMs) }
        logRunnerEvent(ctx, 'kb-daily.skipped', { date: targetDate, fileCount: null, status: 'already-done', ...diagnosticFields(durationMs) })
        return 'already-done'
      }
      if (await reportExists(config.vaultPath, config.reportDir, reportFileName(targetDate))) {
        attemptedDay = targetDate
        const durationMs = Date.now() - startedAt
        currentStatus = { ...currentStatus, state: 'already-done', reportPath: destination, diagnostics: snapshotDiagnostics(diagnostics, durationMs) }
        logRunnerEvent(ctx, 'kb-daily.skipped', { date: targetDate, fileCount: null, status: 'already-done', ...diagnosticFields(durationMs) })
        return 'already-done'
      }
      attemptedDay = targetDate
      const outcome = await runDailyCheck(ctx, config, taskText, {
        date: targetDate,
        trackHandle: handle => handles.add(handle),
      })
      const durationMs = Date.now() - startedAt
      currentStatus = { ...currentStatus, state: 'succeeded', reportPath: destination, diagnostics: snapshotDiagnostics(diagnostics, durationMs) }
      logRunnerEvent(ctx, 'kb-daily.created', { date: targetDate, fileCount: null, status: outcome, ...diagnosticFields(durationMs) })
      notifyHost(ctx, 'kb-daily.created', { date: targetDate, status: outcome, ...diagnosticFields(durationMs) })
      return outcome
    })().catch(error => {
      const approvalTerminal = currentStatus.state === 'rejected' || currentStatus.state === 'timed-out'
      if (approvalTerminal) throw error
      const errorMessage = error instanceof Error ? error.message : String(error)
      const failureReason = redactDiagnosticText(errorMessage, config.vaultPath)
      const durationMs = Date.now() - startedAt
      if (!approvalUnavailable) currentStatus = { ...currentStatus, state: 'failed', lastError: failureReason, diagnostics: snapshotDiagnostics(diagnostics, durationMs) }
      const fields = {
        date: targetDate,
        fileCount: null,
        status: 'failed',
        errorCategory: approvalUnavailable ? 'approval_unavailable' : errorCategory(error),
        failureReason: approvalUnavailable ? currentStatus.lastError : failureReason,
        ...diagnosticFields(durationMs),
      }
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
    disposeToolObserver()
    await Promise.allSettled([...activeRuns])
    await Promise.allSettled([...handles].map(handle => handle.dispose()))
    currentStatus = { ...currentStatus, state: 'stopped' }
  }
  return { control, updateApprovalStatus, stop }
}

/** Start the immediate and interval-based catch-up checks. */
export function startRunner(ctx: Context, config: RunnerConfig, taskText: (date: string) => string): () => Promise<void> {
  return createRunner(ctx, config, taskText).stop
}
