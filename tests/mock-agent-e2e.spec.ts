import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { CallId, LlmAdapter, type GenerateOptions, type LlmModelInfo, type LlmProviderInfo, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as kbDaily from '../src/index.ts'
import { dateKey, reportFileName } from '../src/date.ts'

const kbDailyPlugin = Object.assign(kbDaily.apply, { inject: kbDaily.inject })

type MockStep =
  | { kind: 'tool'; name: string; arguments: Record<string, unknown> }
  | { kind: 'text'; text: string }

class MockAgentAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly toolCalls: string[] = []
  private index = 0

  constructor(private readonly steps: readonly MockStep[]) { super() }

  providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Mock Agent' }
  }

  async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return [{ provider, id: 'mock', name: 'Mock Agent' }]
  }

  async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: 'Mock Agent' }
  }

  async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    this.requests.push(options)
    const step = this.steps[this.index++]
    if (step === undefined) throw new Error('Mock Agent received an unexpected model request')

    if (step.kind === 'tool') {
      const id = CallId(`mock-call-${this.index}`)
      const argumentsJson = JSON.stringify(step.arguments)
      this.toolCalls.push(step.name)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: step.name, argumentsDelta: argumentsJson }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: step.name, arguments: argumentsJson } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: step.text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: step.text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('kb-daily Mock Agent end-to-end', () => {
  it('drives list, read, and write tools through a real Agent Loop', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-e2e-'))
    const today = dateKey(new Date(), 'UTC')
    const report = join(root, 'Daily', reportFileName(today))
    const adapter = new MockAgentAdapter([
      { kind: 'tool', name: 'kb_list_modified', arguments: { since: today } },
      { kind: 'tool', name: 'kb_read', arguments: { path: 'notes/idea.md' } },
      { kind: 'tool', name: 'kb_write_report', arguments: { content: '# Daily digest\n\n- notes/idea.md' } },
      { kind: 'text', text: 'Daily digest written.' },
    ])
    const ctx = new Context()

    try {
      await mkdir(join(root, 'notes'), { recursive: true })
      await writeFile(join(root, 'notes', 'idea.md'), '# Idea\n\nA useful note.')
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(SessionStore)
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(Timer)
      await ctx.plugin(AgentLoop, { agents: [] })
      ctx.llm.registerAdapter(['mock'], adapter)
      await ctx.plugin(kbDailyPlugin, {
        vaultPath: root,
        timeZone: 'UTC',
        provider: 'mock',
        model: 'mock',
        writePolicy: 'allow',
        agentId: 'kb-daily-e2e',
        checkIntervalMs: 60_000,
      })

      await vi.waitFor(() => expect(ctx.agents.get(SessionId('kb-daily-e2e'))).toBeDefined(), { timeout: 5_000 })
      await vi.waitFor(() => expect(adapter.requests).toHaveLength(4), { timeout: 5_000 })
      await ctx.agents.get(SessionId('kb-daily-e2e'))!.whenIdle()

      expect(adapter.toolCalls).toEqual(['kb_list_modified', 'kb_read', 'kb_write_report'])
      expect(adapter.requests[0]?.tools?.map(tool => tool.name)).toEqual(expect.arrayContaining([
        'kb_list_modified', 'kb_read', 'kb_read_diff', 'kb_write_report',
      ]))
      await expect(readFile(report, 'utf8')).resolves.toContain('notes/idea.md')
      await vi.waitFor(() => expect((ctx.get('kbDailyRunner') as { status: () => { state: string } }).status()).toMatchObject({ state: 'succeeded' }), { timeout: 5_000 })
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it.each([
    ['rejected', 'rejected'],
    ['cancelled approval is observable as timed out', 'cancelled'],
  ] as const)('runs the real approval chain for %s', async (_label, outcome) => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-e2e-approval-'))
    const today = dateKey(new Date(), 'UTC')
    const report = join(root, 'Daily', reportFileName(today))
    const adapter = new MockAgentAdapter([
      { kind: 'tool', name: 'kb_list_modified', arguments: { since: today } },
      { kind: 'tool', name: 'kb_read', arguments: { path: 'notes/idea.md' } },
      { kind: 'tool', name: 'kb_write_report', arguments: { content: '# Daily digest' } },
      { kind: 'text', text: 'The report was not written.' },
    ])
    const ctx = new Context()
    try {
      await mkdir(join(root, 'notes'), { recursive: true })
      await writeFile(join(root, 'notes', 'idea.md'), '# Idea\n\nA useful note.')
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(SessionStore)
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(Timer)
      await ctx.plugin(AgentLoop, { agents: [] })
      ctx.llm.registerAdapter(['mock'], adapter)
      ctx.provide('approval', { request: vi.fn(async () => outcome) })
      await ctx.plugin(kbDailyPlugin, {
        vaultPath: root,
        timeZone: 'UTC',
        provider: 'mock',
        model: 'mock',
        writePolicy: 'ask',
        agentId: `kb-daily-e2e-${outcome}`,
        checkIntervalMs: 60_000,
      })

      const runner = ctx.get('kbDailyRunner') as { status: () => { state: string; lastError?: string } }
      const expectedState = outcome === 'rejected' ? 'rejected' : 'timed-out'
      await vi.waitFor(() => expect(runner.status().state).toBe(expectedState), { timeout: 5_000 })
      expect(runner.status().lastError).toMatch(/rejected|cancelled/i)
      await expect(readFile(report, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      expect(adapter.toolCalls).toEqual(['kb_list_modified', 'kb_read', 'kb_write_report'])
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('does not duplicate the real agent workflow while approval is pending', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-e2e-approval-repeat-'))
    const today = dateKey(new Date(), 'UTC')
    let resolveApproval!: (outcome: 'rejected') => void
    const approvalPending = new Promise<'rejected'>(resolve => { resolveApproval = resolve })
    const adapter = new MockAgentAdapter([
      { kind: 'tool', name: 'kb_list_modified', arguments: { since: today } },
      { kind: 'tool', name: 'kb_read', arguments: { path: 'notes/idea.md' } },
      { kind: 'tool', name: 'kb_write_report', arguments: { content: '# Daily digest' } },
      { kind: 'text', text: 'The report was not written.' },
    ])
    const request = vi.fn(() => approvalPending)
    const ctx = new Context()
    try {
      await mkdir(join(root, 'notes'), { recursive: true })
      await writeFile(join(root, 'notes', 'idea.md'), '# Idea\n\nA useful note.')
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(SessionStore)
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(Timer)
      await ctx.plugin(AgentLoop, { agents: [] })
      ctx.llm.registerAdapter(['mock'], adapter)
      ctx.provide('approval', { request })
      await ctx.plugin(kbDailyPlugin, {
        vaultPath: root,
        timeZone: 'UTC',
        provider: 'mock',
        model: 'mock',
        writePolicy: 'ask',
        agentId: 'kb-daily-e2e-repeat',
        checkIntervalMs: 60_000,
      })

      const runner = ctx.get('kbDailyRunner') as { runNow: () => Promise<unknown>; status: () => { state: string } }
      await vi.waitFor(() => expect(runner.status().state).toBe('awaiting-approval'), { timeout: 5_000 })
      const first = runner.runNow()
      const second = runner.runNow()
      expect(request).toHaveBeenCalledOnce()
      resolveApproval('rejected')
      await expect(Promise.all([first, second])).rejects.toThrow(/without creating the report/i)
      expect(request).toHaveBeenCalledOnce()
      expect(runner.status().state).toBe('rejected')
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)
})
