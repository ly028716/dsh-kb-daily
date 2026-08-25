import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertContained, resolveReportPath } from '../src/paths.ts'

describe('kb-daily path containment', () => {
  it('resolves the report path under the vault', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      expect(resolveReportPath(root, 'Daily', '2026-08-17.md')).toBe(join(root, 'Daily', '2026-08-17.md'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('accepts nested contained paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      expect(assertContained(root, 'notes/a.md')).toBe(join(root, 'notes', 'a.md'))
      expect(assertContained(root, './notes/../notes/a.md')).toBe(join(root, 'notes', 'a.md'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('rejects paths that escape the vault', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      expect(() => assertContained(root, '../escape.md')).toThrow(/escapes the vault/)
      expect(() => assertContained(root, '/etc/passwd')).toThrow(/escapes the vault/)
      expect(() => assertContained(root, 'notes/../../escape.md')).toThrow(/escapes the vault/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('rejects report directories and file names that escape the vault', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      expect(() => assertContained(root, 'Daily/../..\\escape.md')).toThrow(/escapes the vault/)
      expect(() => assertContained(root, '../outside')).toThrow(/escapes the vault/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
