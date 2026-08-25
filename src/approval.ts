import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'

export interface ApprovalConfig {
  writePolicy: 'ask' | 'allow'
  reportDir: string
}

/** Route report writes through the host approval service when policy is ask. */
export function registerWriteApproval(ctx: Context, config: ApprovalConfig): () => void {
  return ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (exec.name !== 'kb_write_report' || config.writePolicy === 'allow') return next()
    return { kind: 'ask', reason: `Write the daily knowledge-base report under ${config.reportDir}.` }
  })
}
