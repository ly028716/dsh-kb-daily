import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { boundModifiedFiles, listModifiedFiles, MAX_REPORT_BYTES, readVaultFile, reportExists, writeReport } from '../src/fs.ts'

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
  it('bounds an empty scan, exact limits, file counts, and aggregate bytes explicitly', () => {
    const files = [
      { path: 'a.md', size: 2 },
      { path: 'b.md', size: 3 },
      { path: 'c.md', size: 4 },
    ]
    expect(boundModifiedFiles([], { maxFiles: 1 })).toEqual({ files: [], truncated: false, totalBytes: 0 })
    expect(boundModifiedFiles(files, { maxFiles: 3, maxTotalBytes: 9, maxFileBytes: 4 })).toEqual({
      files,
      truncated: false,
      totalBytes: 9,
    })
    expect(boundModifiedFiles(files, { maxFiles: 2 })).toEqual({ files: files.slice(0, 2), truncated: true, totalBytes: 5 })
    expect(boundModifiedFiles(files, { maxTotalBytes: 4 })).toEqual({ files: files.slice(0, 1), truncated: true, totalBytes: 2 })
    expect(boundModifiedFiles(files, { maxFileBytes: 3 })).toEqual({ files: files.slice(0, 2), truncated: true, totalBytes: 5 })
  })
  it('rejects reads through symbolic-link path segments before opening the file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    const outside = await mkdtemp(join(tmpdir(), 'kb-daily-outside-'))
    try {
      await writeFile(join(outside, 'escape.md'), '# escape')
      await symlink(outside, join(root, 'notes'), 'dir')
      await expect(readVaultFile(root, 'notes/escape.md')).rejects.toThrow(/symbolic link/i)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
  it('writes a report once and refuses to overwrite', async () => {
    const root = await fixtureVault()
    try {
      const abs = await writeReport(root, 'Daily', '2026-08-17.md', '# report')
      expect(abs).toBe(join(root, 'Daily', '2026-08-17.md'))
      expect(await reportExists(root, 'Daily', '2026-08-17.md')).toBe(true)
      await expect(writeReport(root, 'Daily', '2026-08-17.md', '# again')).rejects.toMatchObject({ code: 'EEXIST' })
      expect(await readFile(abs, 'utf8')).toBe('# report')
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
  it('rejects reports larger than the exact UTF-8 byte limit while allowing the boundary value', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    try {
      const exact = 'a'.repeat(MAX_REPORT_BYTES % Buffer.byteLength('你')) +
        '你'.repeat(Math.floor(MAX_REPORT_BYTES / Buffer.byteLength('你')))
      expect(Buffer.byteLength(exact, 'utf8')).toBe(MAX_REPORT_BYTES)
      const abs = await writeReport(root, 'Daily', '2026-08-18.md', exact)
      expect((await readFile(abs, 'utf8')).length).toBe(exact.length)

      const tooLarge = exact + '你'
      expect(Buffer.byteLength(tooLarge, 'utf8')).toBeGreaterThan(MAX_REPORT_BYTES)
      await expect(writeReport(root, 'Daily', '2026-08-19.md', tooLarge)).rejects.toThrow(`${MAX_REPORT_BYTES}`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('rejects report writes through symlinked or junction report directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-vault-'))
    const outside = await mkdtemp(join(tmpdir(), 'kb-daily-outside-'))
    try {
      const linkType = process.platform === 'win32' ? 'junction' : 'dir'
      await symlink(outside, join(root, 'Daily'), linkType)
      await expect(writeReport(root, 'Daily', '2026-08-17.md', '# report')).rejects.toThrow(/symbolic link/i)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
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
