import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
