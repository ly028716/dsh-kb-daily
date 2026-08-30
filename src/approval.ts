import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { logRunnerEvent } from './runner.ts'

export interface ApprovalConfig {
  writePolicy: 'ask' | 'allow'
  reportDir: string
  writeToolName?: string
}

/** Route report writes through the host approval service when policy is ask. */
export function registerWriteApproval(ctx: Context, config: ApprovalConfig): () => void {
  const writeToolName = config.writeToolName ?? 'kb_write_report'
  return ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (exec.name !== writeToolName || config.writePolicy === 'allow') return next()
    logRunnerEvent(ctx, 'kb-daily.approval-required', { status: 'approval-required' })
    return { kind: 'ask', reason: `Write the daily knowledge-base report under ${config.reportDir}.` }
  })
}
