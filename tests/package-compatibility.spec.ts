import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'))

describe('DSH dependency compatibility', () => {
  it('keeps DSH peer and development dependency declarations aligned', () => {
    const dshPeers = Object.keys(packageJson.peerDependencies).filter((name) => name.startsWith('@deepseek-ai/dsh-'))

    expect(dshPeers.length).toBeGreaterThan(0)
    for (const name of dshPeers) {
      expect(packageJson.devDependencies[name], `${name} must be mirrored in devDependencies`).toBe(packageJson.peerDependencies[name])
    }
  })
})
