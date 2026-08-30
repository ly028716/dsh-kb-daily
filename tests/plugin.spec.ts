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

  it('registers isolated namespaced tools and prompt sections for explicit vaults', async () => {
    const first = await mkdtemp(join(tmpdir(), 'kb-daily-multi-first-'))
    const second = await mkdtemp(join(tmpdir(), 'kb-daily-multi-second-'))
    try {
      await mkdir(join(first, 'Daily'))
      await mkdir(join(second, 'Journal'))
      const today = dateKey(new Date(), 'UTC')
      await writeFile(join(first, 'Daily', reportFileName(today)), '# existing')
      await writeFile(join(second, 'Journal', reportFileName(today)), '# existing')
      const tools = new Map<string, unknown>()
      const sections = new Map<string, unknown>()
      const ctx = {
        effect(body: () => () => Promise<void>) { body(); return vi.fn() },
        tools: { register(definition: { name: string }) { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
        systemPrompt: { section(section: { name: string }) { sections.set(section.name, section); return () => sections.delete(section.name) } },
        on: vi.fn(() => vi.fn()),
        interval: vi.fn(() => vi.fn()),
        agents: { get: () => undefined, resume: async () => { throw new Error('not used') }, create: async () => { throw new Error('not used') } },
      } as never

      expect(kbDaily.Config({ vaults: [
        { id: 'work', vaultPath: first, timeZone: 'UTC', agentId: 'kb-daily-work' },
        { id: 'personal', vaultPath: second, timeZone: 'UTC', agentId: 'kb-daily-personal' },
      ] })).toMatchObject({ vaults: [{ id: 'work' }, { id: 'personal' }] })

      kbDaily.apply(ctx, {
        vaults: [
          { id: 'work', vaultPath: first, reportDir: 'Daily', timeZone: 'UTC', agentId: 'kb-daily-work', writePolicy: 'ask', checkIntervalMs: 1000 },
          { id: 'personal', vaultPath: second, reportDir: 'Journal', timeZone: 'UTC', agentId: 'kb-daily-personal', writePolicy: 'ask', checkIntervalMs: 1000 },
        ],
      })

      expect([...tools.keys()]).toEqual([
        'kb_work_list_modified', 'kb_work_read', 'kb_work_read_diff', 'kb_work_write_report',
        'kb_personal_list_modified', 'kb_personal_read', 'kb_personal_read_diff', 'kb_personal_write_report',
      ])
      expect([...sections.keys()]).toEqual(['kb-daily:work:task', 'kb-daily:personal:task'])
      expect((sections.get('kb-daily:work:task') as { text: string }).text).toContain('kb_work_list_modified')
      expect((sections.get('kb-daily:personal:task') as { text: string }).text).toContain('kb_personal_write_report')
    } finally {
      await rm(first, { recursive: true, force: true })
      await rm(second, { recursive: true, force: true })
    }
  })

  it('rejects duplicate identities, overlapping vaults, and mixed legacy/multi-vault config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-multi-conflict-'))
    try {
      await mkdir(join(root, 'Daily'))
      const base = { id: 'work', vaultPath: root, timeZone: 'UTC', agentId: 'kb-daily-work', writePolicy: 'ask' as const, checkIntervalMs: 1000 }
      const ctx = { effect: () => vi.fn() } as never
      expect(() => kbDaily.apply(ctx, { vaults: [base, { ...base, vaultPath: join(root, 'nested'), id: 'work-2', agentId: 'kb-daily-work-2' }] })).toThrow(/overlap|nested/i)
      expect(() => kbDaily.apply(ctx, { vaults: [base, { ...base, id: 'work', agentId: 'kb-daily-other' }] })).toThrow(/unique|duplicate/i)
      expect(() => kbDaily.apply(ctx, { vaults: [base, { ...base, id: 'personal', agentId: 'kb-daily-work' }] })).toThrow(/unique|duplicate/i)
      expect(() => kbDaily.apply(ctx, { vaultPath: root, vaults: [base] })).toThrow(/either|mutually|mixed/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
