import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { registerTools, type ToolsConfig } from '../src/tools.ts'

type RegisteredTool = {
  name: string
  execute(args: unknown, exec: { signal: AbortSignal }): Promise<unknown>
}

function toolContext() {
  const registered = new Map<string, RegisteredTool>()
  const ctx = {
    tools: {
      register(definition: RegisteredTool) {
        registered.set(definition.name, definition)
        return () => registered.delete(definition.name)
      },
    },
  }
  return { ctx: ctx as never, registered }
}

const exec = { signal: new AbortController().signal }

describe('kb-daily model tools', () => {
  it('scans, reads, and writes through the registered public tool definitions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-tools-'))
    try {
      await mkdir(join(root, 'notes'))
      await writeFile(join(root, 'notes', 'today.md'), '# today')
      const { ctx, registered } = toolContext()
      const config: ToolsConfig = { vaultPath: root, reportDir: 'Daily', timeZone: 'UTC' }
      const dispose = registerTools(ctx, config)

      const listed = await registered.get('kb_list_modified')!.execute({ since: '2000-01-01' }, exec)
      expect(listed).toEqual({ files: [{ path: 'notes/today.md', size: 7 }] })
      expect(await registered.get('kb_read')!.execute({ path: 'notes/today.md' }, exec)).toEqual({ content: '# today', truncated: false })
      expect(await registered.get('kb_read')!.execute({ path: '../outside.md' }, exec)).toMatchObject({ code: 'read_failed' })

      const written = await registered.get('kb_write_report')!.execute({ content: '# report' }, exec)
      expect(written).toMatchObject({ date: '2026-08-24', created: true })
      const reportPath = join(root, 'Daily', '2026-08-24.md')
      expect(await readFile(reportPath, 'utf8')).toBe('# report')
      expect(await registered.get('kb_write_report')!.execute({ content: '# overwrite' }, exec)).toMatchObject({ code: 'report_exists' })

      dispose()
      expect(registered.size).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('uses the configured timezone when deriving the report date', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-tools-'))
    try {
      const { ctx, registered } = toolContext()
      registerTools(ctx, { vaultPath: root, reportDir: 'Daily', timeZone: 'Pacific/Honolulu' })
      const value = await registered.get('kb_write_report')!.execute({ content: '# report' }, exec)
      expect(value).toMatchObject({ created: true })
      expect((value as { date: string }).date).toMatch(/^2026-08-2[34]$/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
