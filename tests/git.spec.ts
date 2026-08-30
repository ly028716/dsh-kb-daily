import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { MAX_DIFF_BYTES, readGitDiff } from '../src/git.ts'

vi.setConfig({ testTimeout: 30_000 })

const run = promisify(execFile)

async function git(root: string, ...args: string[]): Promise<void> {
  await run('git', ['-C', root, ...args])
}

async function gitFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kb-daily-git-'))
  await git(root, 'init', '--quiet')
  await git(root, 'config', 'user.email', 'kb-daily@example.invalid')
  await git(root, 'config', 'user.name', 'kb-daily test')
  await writeFile(join(root, 'note.md'), '# original\n')
  await git(root, 'add', 'note.md')
  await git(root, 'commit', '--quiet', '-m', 'initial')
  return root
}

describe('optional Git diff', () => {
  it('reads a bounded diff from a Git vault', async () => {
    const root = await gitFixture()
    try {
      await writeFile(join(root, 'note.md'), '# changed\n')
      const result = await readGitDiff(root, 'note.md')
      expect(result.truncated).toBe(false)
      expect(result.diff).toContain('-# original')
      expect(result.diff).toContain('+# changed')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns git_unavailable for a non-Git vault and a file without history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-daily-nogit-'))
    const historyless = await mkdtemp(join(tmpdir(), 'kb-daily-nohistory-'))
    try {
      await writeFile(join(root, 'note.md'), '# note\n')
      await expect(readGitDiff(root, 'note.md')).rejects.toMatchObject({ code: 'git_unavailable' })
      await git(historyless, 'init', '--quiet')
      await writeFile(join(historyless, 'note.md'), '# note\n')
      await expect(readGitDiff(historyless, 'note.md')).rejects.toMatchObject({ code: 'git_unavailable' })
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(historyless, { recursive: true, force: true })
    }
  })

  it('rejects path escapes, binary files, and oversized diffs', async () => {
    const root = await gitFixture()
    try {
      await expect(readGitDiff(root, '../outside.md')).rejects.toThrow(/escapes the vault/)
      await writeFile(join(root, 'binary.md'), Buffer.from([0, 1, 2]))
      await expect(readGitDiff(root, 'binary.md')).rejects.toMatchObject({ code: 'binary_file' })
      await writeFile(join(root, 'large.md'), 'x\n')
      await git(root, 'add', 'large.md')
      await git(root, 'commit', '--quiet', '-m', 'large base')
      await writeFile(join(root, 'large.md'), 'x'.repeat(MAX_DIFF_BYTES + 1024))
      await expect(readGitDiff(root, 'large.md')).rejects.toMatchObject({ code: 'diff_too_large' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
