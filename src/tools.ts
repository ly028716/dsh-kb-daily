/** Model-facing knowledge-base tools. */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { dateKey, dateStartMs, reportFileName } from './date.ts'
import { listModifiedFiles, readVaultFile, vaultRelative, writeReport } from './fs.ts'
import { resolveReportPath } from './paths.ts'

export interface ToolsConfig {
  vaultPath: string
  reportDir: string
  timeZone: string
  now?: () => Date
}

const ERROR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
  },
} as const

const FILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    size: { type: 'number', required: true },
  },
} as const

const LIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { files: { type: 'array', items: FILE_SCHEMA, required: true } },
} as const

const READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    content: { type: 'string', required: true },
    truncated: { type: 'boolean', required: true },
  },
} as const

const WRITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    date: { type: 'string', required: true },
    created: { type: 'boolean', required: true, const: true },
  },
} as const

const REPORT_EXISTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true, const: 'report_exists' },
    message: { type: 'string', required: true },
  },
} as const

function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

function failure(code: string, error: unknown): { code: string; message: string } {
  return { code, message: error instanceof Error ? error.message : String(error) }
}

/** Register the three knowledge-base tools and return one idempotent disposer. */
export function registerTools(ctx: Context, config: ToolsConfig): () => void {
  const now = config.now ?? (() => new Date())
  const disposers: Array<() => void> = []
  try {
    disposers.push(ctx.tools.register(defineTool({
      name: 'kb_list_modified',
      description: 'List Markdown files modified since a YYYY-MM-DD date in the configured vault time zone.',
      parameters: {
        since: { type: 'string', description: 'YYYY-MM-DD; defaults to today.' },
      },
      output: { schema: { oneOf: [LIST_SCHEMA, ERROR_SCHEMA] }, render: renderValue },
      async execute(args) {
        const since = args.since ?? dateKey(now(), config.timeZone)
        try {
          return { files: await listModifiedFiles(config.vaultPath, dateStartMs(since, config.timeZone)) }
        } catch (error) {
          return failure('list_failed', error)
        }
      },
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: 'kb_read',
      description: 'Read one Markdown file by a vault-relative path; paths outside the vault are rejected.',
      parameters: {
        path: { type: 'string', required: true, description: 'Vault-relative Markdown path.' },
      },
      output: { schema: { oneOf: [READ_SCHEMA, ERROR_SCHEMA] }, render: renderValue },
      async execute(args) {
        try {
          return await readVaultFile(config.vaultPath, args.path)
        } catch (error) {
          return failure('read_failed', error)
        }
      },
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: 'kb_write_report',
      description: 'Write today\'s Markdown report under reportDir/YYYY-MM-DD.md without overwriting an existing report.',
      parameters: {
        content: { type: 'string', required: true, description: 'Complete Markdown report content.' },
      },
      output: { schema: { oneOf: [WRITE_SCHEMA, REPORT_EXISTS_SCHEMA, ERROR_SCHEMA] }, render: renderValue },
      async execute(args) {
        const date = dateKey(now(), config.timeZone)
        const fileName = reportFileName(date)
        try {
          const absolutePath = await writeReport(config.vaultPath, config.reportDir, fileName, args.content)
          return { path: vaultRelative(config.vaultPath, absolutePath), date, created: true }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            return { code: 'report_exists', message: `report already exists: ${resolveReportPath(config.vaultPath, config.reportDir, fileName)}` }
          }
          return failure('write_failed', error)
        }
      },
    })))
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }

  let active = true
  return () => {
    if (!active) return
    active = false
    for (const dispose of disposers.reverse()) dispose()
  }
}
