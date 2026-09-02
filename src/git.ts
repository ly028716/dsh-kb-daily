import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assertContained, assertNoSymlinkSegments } from './paths.ts'

export const MAX_DIFF_BYTES = 128 * 1024

export interface DiffResult {
  diff: string
  truncated: false
}

export class DiffError extends Error {
  readonly code: 'git_unavailable' | 'binary_file' | 'diff_too_large' | 'diff_unreadable' | 'invalid_revision'

  constructor(code: 'git_unavailable' | 'binary_file' | 'diff_too_large' | 'diff_unreadable' | 'invalid_revision', message: string) {
    super(message)
    this.code = code
    this.name = 'DiffError'
  }
}

async function runGitDiff(args: string[]): Promise<Buffer> {
  return await new Promise<Buffer>((resolveOutput, reject) => {
    const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const output: Buffer[] = []
    const errors: Buffer[] = []
    let size = 0
    let settled = false
    const rejectTooLarge = () => {
      if (settled) return
      settled = true
      child.stdout.destroy()
      child.stderr.destroy()
      child.kill()
      reject(new DiffError('diff_too_large', `diff exceeds maximum size of ${MAX_DIFF_BYTES} bytes`))
    }
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > MAX_DIFF_BYTES) {
        rejectTooLarge()
      } else {
        output.push(chunk)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
    child.once('error', error => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.once('close', code => {
      if (settled) return
      settled = true
      if (code !== 0) {
        reject(new Error(Buffer.concat(errors).toString('utf8').trim() || `git exited with code ${code}`))
      } else {
        resolveOutput(Buffer.concat(output))
      }
    })
  })
}

/** Read an optional bounded working-tree diff for one vault-relative Markdown file. */
export async function readGitDiff(vaultPath: string, relPath: string, since?: string): Promise<DiffResult> {
  const revision = since ?? 'HEAD'
  if (revision.startsWith('-')) {
    throw new DiffError('invalid_revision', `Git revision must not start with a dash: ${revision}`)
  }
  const absolutePath = assertContained(vaultPath, relPath)
  await assertNoSymlinkSegments(vaultPath, absolutePath)
  let content: Buffer
  try {
    content = await readFile(absolutePath)
  } catch (error) {
    throw new DiffError('diff_unreadable', `cannot read diff target: ${relPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (content.includes(0)) throw new DiffError('binary_file', `binary files are not supported: ${relPath}`)
  if (content.byteLength > MAX_DIFF_BYTES) throw new DiffError('diff_too_large', `diff exceeds maximum size of ${MAX_DIFF_BYTES} bytes`)

  const args = ['-C', resolve(vaultPath), 'diff', '--no-ext-diff', '--unified=3', '--end-of-options', revision, '--', relPath]
  let stdout: Buffer
  try {
    stdout = await runGitDiff(args)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof DiffError) throw error
    if (code === 'ENOENT' || /not a git repository/i.test(message)) {
      throw new DiffError('git_unavailable', `Git history is unavailable for vault: ${vaultPath}`)
    }
    throw new DiffError('git_unavailable', `Git diff is unavailable: ${message}`)
  }
  return { diff: stdout.toString('utf8'), truncated: false }
}
