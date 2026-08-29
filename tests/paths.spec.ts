import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertContained, assertNoSymlinkSegments, resolveReportPath } from '../src/paths.ts'

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
  it('rejects directory symlink segments while allowing a missing final path under a real directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    const outside = await mkdtemp(join(tmpdir(), 'kb-daily-outside-'))
    try {
      await mkdir(join(root, 'notes'), { recursive: true })
      await symlink(outside, join(root, 'linked-notes'), 'dir')

      await expect(assertNoSymlinkSegments(root, join(root, 'notes', 'future.md'))).resolves.toBeUndefined()
      await expect(assertNoSymlinkSegments(root, join(root, 'linked-notes', 'future.md'))).rejects.toThrow(/symbolic link/i)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
  it('rejects Windows junction segments', async () => {
    if (process.platform !== 'win32') return

    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    const outside = await mkdtemp(join(tmpdir(), 'kb-daily-outside-'))
    try {
      await symlink(outside, join(root, 'Daily'), 'junction')
      await expect(assertNoSymlinkSegments(root, join(root, 'Daily', '2026-08-17.md'))).rejects.toThrow(/symbolic link/i)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})
