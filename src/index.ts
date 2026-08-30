/**
 * Daily catch-up knowledge-base digest.
 * @module @deepseek-ai/dsh-kb-daily
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { accessSync, constants, statSync } from 'node:fs'
import { registerWriteApproval } from './approval.ts'
import { KB_SECTION_NAME, sectionText, taskFraming } from './prompt.ts'
import { startRunner } from './runner.ts'
import { registerTools } from './tools.ts'
import { assertContained } from './paths.ts'

/** Cordis function-plugin name. */
export const name = 'kb-daily'
/** Services required before the plugin can run. */
export const inject = ['agents', 'tools', 'systemPrompt', 'timer']

export interface Config {
  /** Absolute path to the Markdown knowledge-base vault. */
  vaultPath: string
  /** Subdirectory under the vault that receives daily reports (default Daily). */
  reportDir?: string
  /** IANA time zone used for "today"; defaults to the system zone. */
  timeZone?: string
  /** Stable session id of the dedicated KB agent (default kb-daily). */
  agentId?: string
  /** Provider for the dedicated agent; omitted lets the deployment resolve it. */
  provider?: string
  /** Model for the dedicated agent. */
  model?: string
  /** Write approval for kb_write_report: ask (default) or allow. */
  writePolicy?: 'ask' | 'allow'
  /** Day-rollover re-check interval in ms (default 1 hour). */
  checkIntervalMs?: number
  /** Maximum number of modified files included in one scan. */
  maxFiles?: number
  /** Maximum aggregate byte size of files included in one scan. */
  maxTotalBytes?: number
  /** Maximum byte size of an individual file included in one scan. */
  maxFileBytes?: number
}

export const Config = z.object({
  vaultPath: z.string().required(),
  reportDir: z.string().default('Daily'),
  timeZone: z.string(),
  agentId: z.string().default('kb-daily'),
  provider: z.string(),
  model: z.string(),
  writePolicy: z.union([z.const('ask'), z.const('allow')]).default('ask'),
  checkIntervalMs: z.number().default(60 * 60 * 1000),
  maxFiles: z.number().min(1).step(1),
  maxTotalBytes: z.number().min(1).step(1),
  maxFileBytes: z.number().min(1).step(1),
}) as unknown as z<Config>

/** Validate the vault and install all plugin-owned runtime effects. */
export function apply(ctx: Context, config: Config): void {
  const reportDir = config.reportDir ?? 'Daily'
  const timeZone = config.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  const agentId = config.agentId ?? 'kb-daily'
  const writePolicy = config.writePolicy ?? 'ask'
  const checkIntervalMs = config.checkIntervalMs ?? 60 * 60 * 1000
  for (const [name, value] of [
    ['maxFiles', config.maxFiles],
    ['maxTotalBytes', config.maxTotalBytes],
    ['maxFileBytes', config.maxFileBytes],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`kb-daily: ${name} must be a positive integer, got ${value}`)
    }
  }
  if (!Number.isFinite(checkIntervalMs) || checkIntervalMs <= 0) {
    throw new Error(`kb-daily: checkIntervalMs must be a positive finite number, got ${checkIntervalMs}`)
  }

  try {
    if (!statSync(config.vaultPath).isDirectory()) throw new Error('not a directory')
    accessSync(config.vaultPath, constants.R_OK)
    new Intl.DateTimeFormat('en-US', { timeZone }).format()
    assertContained(config.vaultPath, reportDir)
  } catch (error) {
    throw new Error(`kb-daily: vaultPath must be a readable directory and timeZone must be valid (${config.vaultPath})`, { cause: error })
  }

  ctx.effect(() => {
    const disposers: Array<() => void | Promise<void>> = []
    try {
      disposers.push(ctx.systemPrompt.section({ name: KB_SECTION_NAME, order: 200, text: sectionText({ reportDir }) }))
      disposers.push(registerTools(ctx, {
        vaultPath: config.vaultPath,
        reportDir,
        timeZone,
        ...(config.maxFiles === undefined ? {} : { maxFiles: config.maxFiles }),
        ...(config.maxTotalBytes === undefined ? {} : { maxTotalBytes: config.maxTotalBytes }),
        ...(config.maxFileBytes === undefined ? {} : { maxFileBytes: config.maxFileBytes }),
      }))
      disposers.push(registerWriteApproval(ctx, { writePolicy, reportDir }))
      const runnerConfig = {
        vaultPath: config.vaultPath,
        reportDir,
        timeZone,
        agentId,
        checkIntervalMs,
        ...(config.provider === undefined ? {} : { provider: config.provider }),
        ...(config.model === undefined ? {} : { model: config.model }),
      }
      disposers.push(startRunner(ctx, runnerConfig, taskFraming))
    } catch (error) {
      for (const dispose of disposers.reverse()) void dispose()
      throw error
    }
    return async () => {
      for (const dispose of disposers.reverse()) await dispose()
    }
  }, 'kb-daily.lifecycle()')
}
