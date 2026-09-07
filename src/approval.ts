import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import type { ApprovalStatusUpdate } from './runner.ts'
import { logRunnerEvent } from './runner.ts'

export interface ApprovalConfig {
  writePolicy: 'ask' | 'allow'
  reportDir: string
  writeToolName?: string
  onStatusChange?: (update: ApprovalStatusUpdate) => void
}

function reportStatus(config: ApprovalConfig, update: ApprovalStatusUpdate): void {
  try { config.onStatusChange?.(update) } catch { /* status observers must not block tool execution */ }
}

function approvalResultStatus(message: string): ApprovalStatusUpdate | undefined {
  if (/user rejected tool/i.test(message)) return { state: 'rejected', reason: message }
  if (/approval for tool .* was cancelled|approval for tool .* was canceled/i.test(message)) return { state: 'timed-out', reason: message }
  if (/no approval channel is available/i.test(message)) return { state: 'unavailable', reason: message }
  return undefined
}

/** Route report writes through the host approval service when policy is ask. */
export function registerWriteApproval(ctx: Context, config: ApprovalConfig): () => void {
  const writeToolName = config.writeToolName ?? 'kb_write_report'
  const preExecuteDispose = ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (exec.name !== writeToolName || config.writePolicy === 'allow') return next()
    reportStatus(config, { state: 'awaiting-approval' })
    logRunnerEvent(ctx, 'kb-daily.approval-required', { status: 'awaiting-approval' })
    return { kind: 'ask', reason: `Write the daily knowledge-base report under ${config.reportDir}.` }
  })
  if (config.onStatusChange === undefined) return preExecuteDispose

  const resultDispose = ctx.on('tools/result', (exec, result) => {
    if (exec.name !== writeToolName) return
    if (!result.isError) {
      reportStatus(config, { state: 'approved' })
      return
    }
    const message = result.error.message
    const update = approvalResultStatus(message)
    if (update !== undefined) reportStatus(config, update)
  })
  let active = true
  return () => {
    if (!active) return
    active = false
    preExecuteDispose()
    resultDispose()
  }
}
