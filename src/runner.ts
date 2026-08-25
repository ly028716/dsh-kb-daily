import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/cordis-plugin-timer'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { dateKey, reportFileName } from './date.ts'
import { reportExists } from './fs.ts'

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
  trackHandle?: (handle: AgentHandle) => void
}

export type CheckOutcome = 'ran' | 'already-done'

export async function runDailyCheck(ctx: Context, config: RunnerConfig, taskText: (date: string) => string, options: RunOptions = {}): Promise<CheckOutcome> {
  const date = dateKey(options.now ?? new Date(), config.timeZone)
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
    } catch {
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

/** Start the immediate and interval-based catch-up checks. */
export function startRunner(ctx: Context, config: RunnerConfig, taskText: (date: string) => string): () => Promise<void> {
  const handles = new Set<AgentHandle>()
  const activeRuns = new Set<Promise<void>>()
  const guard = createGuard({
    now: () => new Date(),
    timeZone: config.timeZone,
    reportExists: async date => reportExists(config.vaultPath, config.reportDir, reportFileName(date)),
    run: async () => { await runDailyCheck(ctx, config, taskText, { trackHandle: handle => handles.add(handle) }) },
  })
  const invoke = () => {
    const run = guard().catch(() => undefined)
    activeRuns.add(run)
    void run.then(() => activeRuns.delete(run), () => activeRuns.delete(run))
  }
  invoke()
  const stopTimer = ctx.interval(invoke, config.checkIntervalMs)
  let stopped = false
  return async () => {
    if (stopped) return
    stopped = true
    stopTimer()
    await Promise.allSettled([...activeRuns])
    await Promise.allSettled([...handles].map(handle => handle.dispose()))
  }
}
