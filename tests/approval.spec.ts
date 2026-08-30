import { describe, expect, it, vi } from 'vitest'
import { registerWriteApproval } from '../src/approval.ts'

describe('kb-daily write policy', () => {
  it('asks the host approval pipeline before a report write', async () => {
    let listener!: (exec: { name: string }, next: () => Promise<{ kind: 'allow' }>) => Promise<unknown>
    const disposeListener = vi.fn()
    const ctx = { on: vi.fn((_name: string, callback: typeof listener) => { listener = callback; return disposeListener }) } as never
    registerWriteApproval(ctx, { writePolicy: 'ask', reportDir: 'Daily' })
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await expect(listener({ name: 'kb_write_report' }, next)).resolves.toEqual({ kind: 'ask', reason: expect.stringContaining('Daily') })
    expect(next).not.toHaveBeenCalled()
    disposeListener()
    expect(disposeListener).toHaveBeenCalledOnce()
  })

  it('passes writes and unrelated tools under allow policy', async () => {
    let listener!: (exec: { name: string }, next: () => Promise<{ kind: 'allow' }>) => Promise<unknown>
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    const ctx = { on: vi.fn((_name: string, callback: typeof listener) => { listener = callback; return vi.fn() }) } as never
    registerWriteApproval(ctx, { writePolicy: 'allow', reportDir: 'Daily' })
    await expect(listener({ name: 'kb_write_report' }, next)).resolves.toEqual({ kind: 'allow' })
    await expect(listener({ name: 'kb_read' }, next)).resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(2)
  })

  it('asks for a namespaced report write in multi-vault mode', async () => {
    let listener!: (exec: { name: string }, next: () => Promise<{ kind: 'allow' }>) => Promise<unknown>
    const ctx = { on: vi.fn((_name: string, callback: typeof listener) => { listener = callback; return vi.fn() }) } as never
    registerWriteApproval(ctx, { writePolicy: 'ask', reportDir: 'Journal', writeToolName: 'kb_personal_write_report' })
    await expect(listener({ name: 'kb_personal_write_report' }, vi.fn(async () => ({ kind: 'allow' as const })))).resolves.toEqual({ kind: 'ask', reason: expect.stringContaining('Journal') })
  })
})
