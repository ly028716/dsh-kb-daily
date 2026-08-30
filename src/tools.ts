/** Model-facing knowledge-base tools. */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { dateKey, dateStartMs, reportFileName } from './date.ts'
import { boundModifiedFiles, listModifiedFiles, readVaultFile, vaultRelative, writeReport, type ModifiedFilesBudget } from './fs.ts'
import { DiffError, readGitDiff } from './git.ts'
import { resolveReportPath } from './paths.ts'

export interface ToolsConfig {
  vaultPath: string
  reportDir: string
  timeZone: string
  now?: () => Date
  names?: ToolNames
  maxFiles?: number
  maxTotalBytes?: number
  maxFileBytes?: number
}

export interface ToolNames {
  listModified: string
  read: string
  readDiff: string
  writeReport: string
}

/** Return stable model-tool names; legacy single-vault names remain unchanged. */
export function toolNames(namespace?: string): ToolNames {
  const prefix = namespace === undefined ? 'kb' : `kb_${namespace}`
  return {
    listModified: `${prefix}_list_modified`,
    read: `${prefix}_read`,
    readDiff: `${prefix}_read_diff`,
    writeReport: `${prefix}_write_report`,
  }
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
  properties: {
    files: { type: 'array', items: FILE_SCHEMA, required: true },
    truncated: { type: 'boolean', required: true },
    totalBytes: { type: 'number', required: true },
  },
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

const DIFF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    diff: { type: 'string', required: true },
    truncated: { type: 'boolean', required: true, const: false },
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
  const names = config.names ?? toolNames()
  const budget: ModifiedFilesBudget = {
    ...(config.maxFiles === undefined ? {} : { maxFiles: config.maxFiles }),
    ...(config.maxTotalBytes === undefined ? {} : { maxTotalBytes: config.maxTotalBytes }),
    ...(config.maxFileBytes === undefined ? {} : { maxFileBytes: config.maxFileBytes }),
  }
  const disposers: Array<() => void> = []
  try {
    disposers.push(ctx.tools.register(defineTool({
      name: names.listModified,
      description: 'List Markdown files modified since a YYYY-MM-DD date in the configured vault time zone.',
      parameters: {
        since: { type: 'string', description: 'YYYY-MM-DD; defaults to today.' },
      },
      output: { schema: { oneOf: [LIST_SCHEMA, ERROR_SCHEMA] }, render: renderValue },
      async execute(args) {
        const since = args.since ?? dateKey(now(), config.timeZone)
        try {
          return boundModifiedFiles(await listModifiedFiles(config.vaultPath, dateStartMs(since, config.timeZone)), budget)
        } catch (error) {
          return failure('list_failed', error)
        }
      },
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: names.read,
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
      name: names.readDiff,
      description: 'Read an optional bounded Git diff for a vault-relative Markdown file.',
      parameters: {
        path: { type: 'string', required: true, description: 'Vault-relative Markdown path.' },
        since: { type: 'string', description: 'Git revision to diff from; defaults to HEAD.' },
      },
      output: { schema: { oneOf: [DIFF_SCHEMA, ERROR_SCHEMA] }, render: renderValue },
      async execute(args) {
        try {
          return await readGitDiff(config.vaultPath, args.path, args.since)
        } catch (error) {
          if (error instanceof DiffError) return failure(error.code, error)
          return failure('git_unavailable', error)
        }
      },
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: names.writeReport,
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
