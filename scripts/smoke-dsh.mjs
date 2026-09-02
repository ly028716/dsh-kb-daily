import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')
const dshBin = resolve(projectRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const pnpmExecPath = process.env.npm_execpath

if (!pnpmExecPath) {
  throw new Error('smoke:dsh must run under pnpm so npm_execpath is available')
}

function formatUtcDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const field = (type) => {
    const part = parts.find((candidate) => candidate.type === type)
    if (!part) throw new Error(`missing ${type} in UTC date formatter output`)
    return part.value
  }

  return `${field('year')}-${field('month')}-${field('day')}`
}

function runNode(args, env, cwd = projectRoot) {
  return execFileSync(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function yamlString(value) {
  return JSON.stringify(value.replace(/\\/g, '/'))
}

function moduleUrl(path) {
  return pathToFileURL(path).href
}

function probePluginRuntime(profileDir, vaultDir, reportPath) {
  const pluginPath = join(profileDir, 'node_modules', '@ly028716', 'dsh-kb-daily', 'lib', 'index.js')
  const source = `
    import { readFileSync } from 'node:fs'
    import { Context } from ${JSON.stringify(moduleUrl(join(projectRoot, 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js')))}
    import Timer from ${JSON.stringify(moduleUrl(join(projectRoot, 'node_modules', '@deepseek-ai', 'cordis-plugin-timer', 'lib', 'index.js')))}
    import AgentRegistry from ${JSON.stringify(moduleUrl(join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh-agent', 'lib', 'index.js')))}
    import { CallId } from ${JSON.stringify(moduleUrl(join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh-llm', 'lib', 'index.js')))}
    import SystemPrompt from ${JSON.stringify(moduleUrl(join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh-system-prompt', 'lib', 'index.js')))}
    import ToolRuntime from ${JSON.stringify(moduleUrl(join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')))}
    import * as kbDaily from ${JSON.stringify(moduleUrl(pluginPath))}

    const ctx = new Context()
    try {
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(Timer)
      await ctx.plugin(Object.assign(kbDaily.apply, { inject: kbDaily.inject }), {
        vaultPath: ${JSON.stringify(vaultDir)},
        reportDir: 'Daily',
        timeZone: 'UTC',
        writePolicy: 'ask',
        checkIntervalMs: 3600000,
      })

      for (const name of ['kb_list_modified', 'kb_read', 'kb_read_diff', 'kb_write_report']) {
        if (ctx.tools.get(name) === undefined) throw new Error(\`packed plugin did not register tool: \${name}\`)
      }

      const result = await ctx.tools.execute({
        callId: CallId('smoke-write-report'),
        name: 'kb_write_report',
        arguments: { content: '# replacement report' },
        signal: new AbortController().signal,
      })
      if (!result.isError) throw new Error('writePolicy: ask allowed kb_write_report without approval')
      if (!result.error.message.includes('Write the daily knowledge-base report under Daily.')) {
        throw new Error(\`writePolicy: ask returned an unexpected denial: \${result.error.message}\`)
      }
      if (readFileSync(${JSON.stringify(reportPath)}, 'utf8') !== '# preexisting report\\n') {
        throw new Error('writePolicy: ask changed the preexisting report')
      }
    } finally {
      await ctx.fiber.dispose()
    }
  `
  runNode(['--input-type=module', '--eval', source], {})
}

const tempRoot = mkdtempSync(join(tmpdir(), 'kb-daily-smoke-'))

try {
  const dshHome = join(tempRoot, 'dsh-home')
  const artifactDir = join(tempRoot, 'artifacts')
  const vaultDir = join(tempRoot, 'vault')
  const dailyDir = join(vaultDir, 'Daily')
  const reportDate = formatUtcDate()
  const profileDir = join(dshHome, 'profiles', 'smoke')
  const env = {
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: '1',
  }

  mkdirSync(dshHome, { recursive: true })
  mkdirSync(artifactDir, { recursive: true })
  mkdirSync(dailyDir, { recursive: true })
  writeFileSync(join(dailyDir, `${reportDate}.md`), '# preexisting report\n', 'utf8')

  runNode([pnpmExecPath, 'pack', '--pack-destination', artifactDir], env)

  const tarballName = readdirSync(artifactDir).find((entry) => entry.endsWith('.tgz'))
  if (!tarballName) {
    throw new Error(`pnpm pack did not produce a tarball in ${artifactDir}`)
  }

  const tarballPath = join(artifactDir, tarballName)

  runNode([dshBin, 'plugin', '--profile', 'smoke', 'add', tarballPath], env)

  writeFileSync(join(profileDir, 'cordis.patch.yml'), [
    '- id: kb-daily',
    '  config:',
    `    vaultPath: ${yamlString(vaultDir)}`,
    '    reportDir: Daily',
    '    timeZone: UTC',
    '    writePolicy: ask',
    '    checkIntervalMs: 3600000',
    '',
  ].join('\n'), 'utf8')

  const dumpConfig = runNode([dshBin, '--profile', 'smoke', '--dump-config'], env)

  for (const snippet of [
    '# == @ly028716/dsh-kb-daily',
    'id: kb-daily',
    "name: '@ly028716/dsh-kb-daily'",
    'reportDir: Daily',
  ]) {
    if (!dumpConfig.includes(snippet)) {
      throw new Error(`dsh --dump-config is missing expected output: ${snippet}`)
    }
  }

  probePluginRuntime(profileDir, vaultDir, join(dailyDir, `${reportDate}.md`))
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
