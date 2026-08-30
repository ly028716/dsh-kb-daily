import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as kbDaily from '../src/index.ts'
import { dateKey, reportFileName } from '../src/date.ts'

describe('kb-daily plugin export shape', () => {
  it('has the Loader-safe function-plugin export shape', () => {
    expect('default' in kbDaily).toBe(false)
    expect(kbDaily.name).toBe('kb-daily')
    expect(kbDaily.inject).toEqual(['agents', 'tools', 'systemPrompt', 'timer'])
    expect(kbDaily.Config).toBeDefined()
    expect(typeof kbDaily.apply).toBe('function')
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(kbDaily)).toBe(kbDaily)
  })

  it('loads the real entry and removes every registration, listener, and timer on dispose', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-plugin-'))
    try {
      await mkdir(join(root, 'Daily'))
      await writeFile(join(root, 'Daily', reportFileName(dateKey(new Date(), 'UTC'))), '# existing')
      const tools = new Map<string, unknown>()
      const sections = new Map<string, unknown>()
      const listeners = new Map<string, unknown>()
      let timerDisposed = false
      let lifecycle!: () => Promise<void>
      const ctx = {
        effect(body: () => () => Promise<void>) {
          lifecycle = body()
          return vi.fn()
        },
        tools: { register(definition: { name: string }) { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
        systemPrompt: { section(section: { name: string }) { sections.set(section.name, section); return () => sections.delete(section.name) } },
        on(name: string, listener: unknown) { listeners.set(name, listener); return () => listeners.delete(name) },
        interval(_callback: () => void, _delay: number) { return () => { timerDisposed = true } },
        agents: { get: () => undefined, resume: async () => { throw new Error('not used') }, create: async () => { throw new Error('not used') } },
      } as never

      kbDaily.apply(ctx, { vaultPath: root, timeZone: 'UTC', agentId: 'kb-test', writePolicy: 'ask', checkIntervalMs: 1000 })
      expect([...tools.keys()]).toEqual(['kb_list_modified', 'kb_read', 'kb_read_diff', 'kb_write_report'])
      expect(sections.has('kb-daily:task')).toBe(true)
      expect(listeners.has('tools/pre-execute')).toBe(true)
      await lifecycle()
      expect(tools.size).toBe(0)
      expect(sections.size).toBe(0)
      expect(listeners.size).toBe(0)
      expect(timerDisposed).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves the source entry through a real Cordis Loader', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(Loader, { baseUrl: new URL('../', import.meta.url).href })
      const entryId = await ctx.loader.create({ name: './src/index.ts', config: { vaultPath: process.cwd() } })
      await ctx.loader.await()
      expect(ctx.loader.resolve(entryId)?.options.name).toBe('./src/index.ts')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('fails the real entry before registering anything for an invalid vault', () => {
    const ctx = { effect: () => { throw new Error('effect must not run') } } as never
    expect(() => kbDaily.apply(ctx, { vaultPath: join(tmpdir(), 'does-not-exist') })).toThrow(/vaultPath/)
  })

  it('rejects a report directory outside the vault at load time', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-plugin-'))
    try {
      expect(() => kbDaily.apply({ effect: () => vi.fn() } as never, { vaultPath: root, reportDir: '../outside' })).toThrow(/vaultPath/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
