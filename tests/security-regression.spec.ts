import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'

const { lstatMock, mkdirMock, openMock, readFileMock, writeFileMock } = vi.hoisted(() => ({
  lstatMock: vi.fn(),
  mkdirMock: vi.fn(),
  openMock: vi.fn(),
  readFileMock: vi.fn(),
  writeFileMock: vi.fn(),
}))

vi.mock('node:fs/promises', async () => ({
  ...(await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')),
  lstat: lstatMock,
  mkdir: mkdirMock,
  open: openMock,
  readFile: readFileMock,
  writeFile: writeFileMock,
}))

const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
const { MAX_REPORT_BYTES, readVaultFile, writeReport } = await import('../src/fs.ts')

function resetFsMocks(): void {
  lstatMock.mockReset().mockImplementation((path: string) => actualFs.lstat(path))
  mkdirMock.mockReset().mockImplementation((path: string, options?: Parameters<typeof actualFs.mkdir>[1]) => actualFs.mkdir(path, options as never))
  openMock.mockReset().mockImplementation((path: string, flags: Parameters<typeof actualFs.open>[1]) => actualFs.open(path, flags))
  readFileMock.mockReset().mockImplementation((path: string, options?: Parameters<typeof actualFs.readFile>[1]) => actualFs.readFile(path, options as never))
  writeFileMock.mockReset().mockImplementation((path: string, data: Parameters<typeof actualFs.writeFile>[1], options?: Parameters<typeof actualFs.writeFile>[2]) => actualFs.writeFile(path, data, options as never))
}

describe('security regression matrix', () => {
  it('rejects a file replaced by a relative symlink after the path check', async () => {
    resetFsMocks()
    const root = await actualFs.mkdtemp(join(tmpdir(), 'kb-daily-security-'))
    const outside = await actualFs.mkdtemp(join(tmpdir(), 'kb-daily-security-outside-'))
    try {
      const victim = join(root, 'victim.md')
      const outsideFile = join(outside, 'outside.md')
      await actualFs.writeFile(victim, '# inside')
      await actualFs.writeFile(outsideFile, '# outside')
      let armed = true
      lstatMock.mockImplementation(async (path: string) => {
        const info = await actualFs.lstat(path)
        if (armed && path === victim) {
          armed = false
          await actualFs.rm(victim)
          await actualFs.symlink(relative(dirname(victim), outsideFile), victim, 'file')
        }
        return info
      })

      await expect(readVaultFile(root, 'victim.md')).rejects.toThrow(/symbolic link|ELOOP|escapes the vault/i)
      expect(await actualFs.readFile(outsideFile, 'utf8')).toBe('# outside')
    } finally {
      await actualFs.rm(root, { recursive: true, force: true })
      await actualFs.rm(outside, { recursive: true, force: true })
    }
  })

  it('preserves permission failures without decoding or returning file contents', async () => {
    resetFsMocks()
    const root = await actualFs.mkdtemp(join(tmpdir(), 'kb-daily-security-'))
    try {
      const file = join(root, 'secret.md')
      await actualFs.writeFile(file, 'sensitive content')
      const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' })
      openMock.mockRejectedValue(permissionError)
      readFileMock.mockRejectedValue(permissionError)

      await expect(readVaultFile(root, 'secret.md')).rejects.toMatchObject({ code: 'EACCES' })
    } finally {
      await actualFs.rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a report directory replaced by a junction during directory creation', async () => {
    if (process.platform !== 'win32') return

    resetFsMocks()
    const root = await actualFs.mkdtemp(join(tmpdir(), 'kb-daily-security-'))
    const outside = await actualFs.mkdtemp(join(tmpdir(), 'kb-daily-security-outside-'))
    const reportRoot = join(root, 'Daily')
    try {
      let armed = true
      mkdirMock.mockImplementation(async (path: string, options?: Parameters<typeof actualFs.mkdir>[1]) => {
        const result = await actualFs.mkdir(path, options as never)
        if (armed && path === reportRoot) {
          armed = false
          await actualFs.rm(reportRoot, { recursive: true, force: true })
          await actualFs.symlink(outside, reportRoot, 'junction')
        }
        return result
      })

      await expect(writeReport(root, 'Daily', '2026-09-10.md', '# report')).rejects.toThrow(/symbolic link/i)
      await expect(actualFs.readFile(join(outside, '2026-09-10.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await actualFs.rm(root, { recursive: true, force: true })
      await actualFs.rm(outside, { recursive: true, force: true })
    }
  })

  it('rejects a permission failure while writing a report and keeps the size guard byte-based', async () => {
    resetFsMocks()
    const root = await actualFs.mkdtemp(join(tmpdir(), 'kb-daily-security-'))
    try {
      const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' })
      writeFileMock.mockRejectedValue(permissionError)
      await expect(writeReport(root, 'Daily', '2026-09-10.md', '# report')).rejects.toMatchObject({ code: 'EACCES' })
      await expect(writeReport(root, 'Daily', 'too-large.md', 'x'.repeat(MAX_REPORT_BYTES + 1))).rejects.toThrow(/maximum size/i)
    } finally {
      await actualFs.rm(root, { recursive: true, force: true })
    }
  })
})
