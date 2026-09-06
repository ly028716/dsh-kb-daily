import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function releaseTagForPackageVersion(version) {
  return `v${version}`
}

export function assertReleaseMetadata({ version, tag, changelog }) {
  if (tag !== releaseTagForPackageVersion(version)) {
    throw new Error(`Release tag ${tag} does not match package version ${version}`)
  }
  if (!new RegExp(`^##\\s+${version.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?:\\s|$)`, 'm').test(changelog)) {
    throw new Error(`CHANGELOG.md is missing a section for ${version}`)
  }
}

function run() {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'))
  const changelog = readFileSync(resolve(repositoryRoot, 'CHANGELOG.md'), 'utf8')

  assertReleaseMetadata({
    version: packageJson.version,
    tag: process.argv[2],
    changelog,
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    run()
  } catch (error) {
    console.error(`Release metadata check failed: ${error.message}`)
    process.exitCode = 1
  }
}
