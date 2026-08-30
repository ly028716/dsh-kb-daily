/**
 * Daily catch-up knowledge-base digest.
 * @module @deepseek-ai/dsh-kb-daily
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { accessSync, constants, statSync } from 'node:fs'
import { registerWriteApproval } from './approval.ts'
import { sectionName, sectionText, taskFraming } from './prompt.ts'
import { startRunner } from './runner.ts'
import { registerTools, toolNames, type ToolNames } from './tools.ts'
import { assertContained } from './paths.ts'
import { isAbsolute, relative, resolve } from 'node:path'

/** Cordis function-plugin name. */
export const name = 'kb-daily'
/** Services required before the plugin can run. */
export const inject = ['agents', 'tools', 'systemPrompt', 'timer']

export interface Config {
  /** Absolute path to the Markdown knowledge-base vault. */
  vaultPath?: string
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
  /** Explicit multi-vault configuration. Cannot be combined with legacy fields. */
  vaults?: VaultConfig[]
}

export interface VaultConfig {
  /** Stable namespace used for tools and lifecycle events. */
  id: string
  /** Absolute path to this Markdown knowledge-base vault. */
  vaultPath: string
  reportDir?: string
  timeZone?: string
  /** Required in multi-vault mode so sessions can never collide implicitly. */
  agentId: string
  provider?: string
  model?: string
  writePolicy?: 'ask' | 'allow'
  checkIntervalMs?: number
  maxFiles?: number
  maxTotalBytes?: number
  maxFileBytes?: number
}

const SharedConfig = {
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
}

const SingleConfig = z.object({
  vaultPath: z.string().required(),
  ...SharedConfig,
})

const MultiVaultConfig = z.object({
  vaults: z.array(z.object({
    id: z.string().required().pattern(/^[a-z][a-z0-9-]{0,31}$/),
    vaultPath: z.string().required(),
    reportDir: z.string().default('Daily'),
    timeZone: z.string(),
    agentId: z.string().required(),
    provider: z.string(),
    model: z.string(),
    writePolicy: z.union([z.const('ask'), z.const('allow')]).default('ask'),
    checkIntervalMs: z.number().default(60 * 60 * 1000),
    maxFiles: z.number().min(1).step(1),
    maxTotalBytes: z.number().min(1).step(1),
    maxFileBytes: z.number().min(1).step(1),
  })).min(1).required(),
})

export const Config = z.union([SingleConfig, MultiVaultConfig]) as unknown as z<Config>

interface NormalizedVault {
  id?: string
  vaultPath: string
  reportDir: string
  timeZone: string
  agentId: string
  provider?: string
  model?: string
  writePolicy: 'ask' | 'allow'
  checkIntervalMs: number
  maxFiles?: number
  maxTotalBytes?: number
  maxFileBytes?: number
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function normalizeVaults(config: Config): NormalizedVault[] {
  if (config.vaults !== undefined) {
    if (config.vaultPath !== undefined) throw new Error('kb-daily: configure either vaultPath or vaults, not both')
    if (config.vaults.length === 0) throw new Error('kb-daily: vaults must contain at least one entry')
    const ids = new Set<string>()
    const agents = new Set<string>()
    const roots = config.vaults.map(vault => resolve(vault.vaultPath))
    for (let index = 0; index < config.vaults.length; index++) {
      const vault = config.vaults[index]!
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(vault.id)) throw new Error(`kb-daily: vault id must match [a-z][a-z0-9-]{0,31}: ${vault.id}`)
      if (!vault.agentId) throw new Error(`kb-daily: agentId is required for vault: ${vault.id}`)
      if (ids.has(vault.id)) throw new Error(`kb-daily: duplicate vault id: ${vault.id}`)
      ids.add(vault.id)
      if (agents.has(vault.agentId)) throw new Error(`kb-daily: duplicate agentId: ${vault.agentId}`)
      agents.add(vault.agentId)
      for (let other = 0; other < index; other++) {
        if (isWithin(roots[other]!, roots[index]!) || isWithin(roots[index]!, roots[other]!)) {
          throw new Error(`kb-daily: vault paths overlap or are nested: ${vault.vaultPath}`)
        }
      }
    }
    return config.vaults.map(vault => normalizeVault(vault, vault.id))
  }
  if (config.vaultPath === undefined) throw new Error('kb-daily: configure vaultPath or explicit vaults')
  return [normalizeVault(config, undefined)]
}

function normalizeVault(config: Config | VaultConfig, id: string | undefined): NormalizedVault {
  if (config.vaultPath === undefined) throw new Error('kb-daily: vaultPath is required for each vault')
  return {
    ...(id === undefined ? {} : { id }),
    vaultPath: config.vaultPath,
    reportDir: config.reportDir ?? 'Daily',
    timeZone: config.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    agentId: config.agentId ?? 'kb-daily',
    ...(config.provider === undefined ? {} : { provider: config.provider }),
    ...(config.model === undefined ? {} : { model: config.model }),
    writePolicy: config.writePolicy ?? 'ask',
    checkIntervalMs: config.checkIntervalMs ?? 60 * 60 * 1000,
    ...(config.maxFiles === undefined ? {} : { maxFiles: config.maxFiles }),
    ...(config.maxTotalBytes === undefined ? {} : { maxTotalBytes: config.maxTotalBytes }),
    ...(config.maxFileBytes === undefined ? {} : { maxFileBytes: config.maxFileBytes }),
  }
}

function validateVault(vault: NormalizedVault): void {
  for (const [name, value] of [
    ['maxFiles', vault.maxFiles],
    ['maxTotalBytes', vault.maxTotalBytes],
    ['maxFileBytes', vault.maxFileBytes],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`kb-daily: ${name} must be a positive integer, got ${value}`)
    }
  }
  if (!Number.isFinite(vault.checkIntervalMs) || vault.checkIntervalMs <= 0) {
    throw new Error(`kb-daily: checkIntervalMs must be a positive finite number, got ${vault.checkIntervalMs}`)
  }
  try {
    if (!statSync(vault.vaultPath).isDirectory()) throw new Error('not a directory')
    accessSync(vault.vaultPath, constants.R_OK)
    new Intl.DateTimeFormat('en-US', { timeZone: vault.timeZone }).format()
    assertContained(vault.vaultPath, vault.reportDir)
  } catch (error) {
    throw new Error(`kb-daily: vaultPath must be a readable directory and timeZone must be valid (${vault.vaultPath})`, { cause: error })
  }
}

/** Validate the vault and install all plugin-owned runtime effects. */
export function apply(ctx: Context, config: Config): void {
  const vaults = normalizeVaults(config)
  vaults.forEach(validateVault)

  ctx.effect(() => {
    const disposers: Array<() => void | Promise<void>> = []
    try {
      for (const vault of vaults) {
        const names: ToolNames = toolNames(vault.id)
        disposers.push(ctx.systemPrompt.section({ name: sectionName(vault.id), order: 200, text: sectionText({ reportDir: vault.reportDir, toolNames: names }) }))
        disposers.push(registerTools(ctx, {
          vaultPath: vault.vaultPath,
          reportDir: vault.reportDir,
          timeZone: vault.timeZone,
          names,
          ...(vault.maxFiles === undefined ? {} : { maxFiles: vault.maxFiles }),
          ...(vault.maxTotalBytes === undefined ? {} : { maxTotalBytes: vault.maxTotalBytes }),
          ...(vault.maxFileBytes === undefined ? {} : { maxFileBytes: vault.maxFileBytes }),
        }))
        disposers.push(registerWriteApproval(ctx, { writePolicy: vault.writePolicy, reportDir: vault.reportDir, writeToolName: names.writeReport }))
        disposers.push(startRunner(ctx, {
          vaultPath: vault.vaultPath,
          reportDir: vault.reportDir,
          timeZone: vault.timeZone,
          agentId: vault.agentId,
          checkIntervalMs: vault.checkIntervalMs,
          ...(vault.provider === undefined ? {} : { provider: vault.provider }),
          ...(vault.model === undefined ? {} : { model: vault.model }),
        }, taskFraming))
      }
    } catch (error) {
      for (const dispose of disposers.reverse()) void dispose()
      throw error
    }
    return async () => {
      for (const dispose of disposers.reverse()) await dispose()
    }
  }, 'kb-daily.lifecycle()')
}
