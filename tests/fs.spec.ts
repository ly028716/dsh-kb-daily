import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listModifiedFiles, readVaultFile, reportExists, writeReport } from '../src/fs.ts'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

async function fixtureVault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
  await mkdir(join(root, 'notes'), { recursive: true })
  const now = Date.now()
  await writeFile(join(root, 'notes', 'today.md'), '# today')
  await utimes(join(root, 'notes', 'today.md'), new Date(now), new Date(now))
  await writeFile(join(root, 'notes', 'old.md'), '# old')
  await utimes(join(root, 'notes', 'old.md'), new Date(now - 2 * DAY), new Date(now - 2 * DAY))
  await writeFile(join(root, 'ignored.txt'), 'not markdown')
  return root
}

describe('kb-daily fs operations', () => {
  it('lists only .md files modified since the cutoff, sorted, vault-relative', async () => {
    const root = await fixtureVault()
    try {
      const files = await listModifiedFiles(root, Date.now() - HOUR)
      expect(files).toEqual([{ path: 'notes/today.md', size: 7 }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('reads contained files and truncates over the cap', async () => {
    const root = await fixtureVault()
    try {
      expect(await readVaultFile(root, 'notes/today.md')).toEqual({ content: '# today', truncated: false })
      expect(await readVaultFile(root, 'notes/today.md', 3)).toEqual({ content: '# t', truncated: true })
      await expect(readVaultFile(root, '../outside.md')).rejects.toThrow(/escapes the vault/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('writes a report once and refuses to overwrite', async () => {
    const root = await fixtureVault()
    try {
      const abs = await writeReport(root, 'Daily', '2026-08-17.md', '# report')
      expect(abs).toBe(join(root, 'Daily', '2026-08-17.md'))
      expect(await reportExists(root, 'Daily', '2026-08-17.md')).toBe(true)
      await expect(writeReport(root, 'Daily', '2026-08-17.md', '# again')).rejects.toMatchObject({ code: 'EEXIST' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('rejects a report directory that escapes the vault before creating directories', async () => {
    const root = await fixtureVault()
    try {
      await expect(writeReport(root, '../outside', '2026-08-17.md', '# report')).rejects.toThrow(/escapes the vault/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('skips hidden and bookkeeping directories and descends into nested ones', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      await mkdir(join(root, 'nested'), { recursive: true })
      await mkdir(join(root, '.git'), { recursive: true })
      await mkdir(join(root, '.hidden'), { recursive: true })
      await writeFile(join(root, 'nested', 'deep.md'), '# deep')
      await writeFile(join(root, '.git', 'skip.md'), '# skip')
      await writeFile(join(root, '.hidden', 'skip2.md'), '# skip2')
      const files = await listModifiedFiles(root, 0)
      expect(files).toEqual([{ path: 'nested/deep.md', size: 6 }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('skips node_modules and sorts multiple matches by path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      await mkdir(join(root, 'node_modules'), { recursive: true })
      await writeFile(join(root, 'node_modules', 'skip.md'), '# skip')
      await writeFile(join(root, 'z.md'), '# z')
      await writeFile(join(root, 'a.md'), '# a')
      const files = await listModifiedFiles(root, 0)
      expect(files).toEqual([
        { path: 'a.md', size: 3 },
        { path: 'z.md', size: 3 },
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('reports a missing report file as not existing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      expect(await reportExists(root, 'Daily', '2026-08-17.md')).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('rethrows non-missing report-existence errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      // A NUL byte makes stat throw ERR_INVALID_ARG_VALUE (a TypeError with no errno code).
      await expect(reportExists(root, 'Daily', 'bad\0name.md')).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('truncates at a UTF-8 character boundary without replacement characters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      await writeFile(join(root, 'chinese.md'), '你好世界')
      expect(await readVaultFile(root, 'chinese.md')).toEqual({ content: '你好世界', truncated: false })
      const cut = await readVaultFile(root, 'chinese.md', 5)
      expect(cut.truncated).toBe(true)
      expect(cut.content).toBe('你')
      expect(cut.content.includes('\uFFFD')).toBe(false)
      expect((await readVaultFile(root, 'chinese.md', 6)).content).toBe('你好')
      expect((await readVaultFile(root, 'chinese.md', 8)).content).toBe('你好')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('handles empty, 2/4-byte, and degenerate UTF-8 inputs at the cut boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      await writeFile(join(root, 'empty.md'), '')
      expect(await readVaultFile(root, 'empty.md')).toEqual({ content: '', truncated: false })
      await writeFile(join(root, 'latin.md'), 'café')
      expect((await readVaultFile(root, 'latin.md', 4)).content).toBe('caf')
      expect((await readVaultFile(root, 'latin.md', 5)).content).toBe('café')
      await writeFile(join(root, 'emoji.md'), 'a😀b')
      expect((await readVaultFile(root, 'emoji.md', 2)).content).toBe('a')
      expect((await readVaultFile(root, 'emoji.md', 3)).content).toBe('a')
      expect((await readVaultFile(root, 'emoji.md', 5)).content).toBe('a😀')
      await writeFile(join(root, 'junk.md'), Buffer.from([0x80, 0x80]))
      const junk = await readVaultFile(root, 'junk.md')
      expect(junk.truncated).toBe(false)
      expect(junk.content).toBe('\uFFFD\uFFFD')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('normalizes a trailing-separator vault path when listing', async () => {
    const root = await fixtureVault()
    try {
      const files = await listModifiedFiles(root + sep, Date.now() - HOUR)
      expect(files).toEqual([{ path: 'notes/today.md', size: 7 }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
