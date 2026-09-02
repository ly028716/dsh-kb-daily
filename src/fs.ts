import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { assertContained, assertNoSymlinkSegments } from './paths.ts'

/** One .md file found by a vault scan. */
export interface ModifiedFile {
  /** Vault-relative path with forward slashes. */
  path: string
  /** Byte size. */
  size: number
}

/** Explicit scan budgets applied after the deterministic vault walk. */
export interface ModifiedFilesBudget {
  maxFiles?: number
  maxTotalBytes?: number
  maxFileBytes?: number
}

/** A bounded scan result with enough metadata for callers to disclose truncation. */
export interface ModifiedFilesResult {
  files: ModifiedFile[]
  truncated: boolean
  totalBytes: number
}

/** Directories never scanned for notes. */
const SKIP_DIRECTORIES = new Set(['.git', '.obsidian', '.trash', 'node_modules'])

/** Hard cap for one generated report in UTF-8 bytes. */
export const MAX_REPORT_BYTES = 512 * 1024

/**
 * Vault-relative path with forward slashes for one absolute path inside the vault.
 * @param vaultPath - absolute path to the vault root; trailing separators are normalized away.
 * @param abs - absolute path inside the vault.
 * @returns the vault-relative path with forward slashes.
 */
export function vaultRelative(vaultPath: string, abs: string): string {
  const root = resolve(vaultPath)
  return abs.slice(root.length + 1).replaceAll('\\', '/')
}

/**
 * Recursively list .md files under the vault with mtime >= sinceMs.
 * @param vaultPath - absolute path to the vault root.
 * @param sinceMs - cutoff; only files whose mtime is at or after this are listed.
 * @returns vault-relative .md file paths, sorted by path, with byte sizes.
 */
export async function listModifiedFiles(vaultPath: string, sinceMs: number): Promise<ModifiedFile[]> {
  const root = resolve(vaultPath)
  await assertNoSymlinkSegments(root, root)
  const found: ModifiedFile[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !SKIP_DIRECTORIES.has(entry.name)) {
          await walk(join(dir, entry.name))
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const abs = join(dir, entry.name)
        const info = await stat(abs)
        if (info.mtimeMs >= sinceMs) {
          found.push({ path: vaultRelative(root, abs), size: info.size })
        }
      }
    }
  }
  await walk(root)
  found.sort((a, b) => a.path.localeCompare(b.path))
  return found
}

/** Apply explicit budgets in stable path order without silently discarding scope. */
export function boundModifiedFiles(files: ModifiedFile[], budget: ModifiedFilesBudget = {}): ModifiedFilesResult {
  const selected: ModifiedFile[] = []
  let totalBytes = 0
  let truncated = false
  for (const file of files) {
    if (budget.maxFileBytes !== undefined && file.size > budget.maxFileBytes) {
      truncated = true
      continue
    }
    if (budget.maxFiles !== undefined && selected.length >= budget.maxFiles) {
      truncated = true
      continue
    }
    if (budget.maxTotalBytes !== undefined && totalBytes + file.size > budget.maxTotalBytes) {
      truncated = true
      continue
    }
    selected.push(file)
    totalBytes += file.size
  }
  return { files: selected, truncated, totalBytes }
}

/**
 * Drop a trailing incomplete UTF-8 sequence so decoding never yields U+FFFD.
 * A trailing continuation byte alone does not imply incompleteness: every
 * complete multi-byte character ends with a continuation byte, so the lead
 * byte's declared sequence length decides whether the tail is complete. A
 * bare lead byte at the end is always incomplete and is dropped.
 */
function trimToCharBoundary(buffer: Buffer): Buffer {
  const end = buffer.byteLength
  if (end === 0) return buffer
  const last = buffer[end - 1]
  if (last === undefined) return buffer
  if (last >= 0xc0 && last <= 0xf7) return buffer.subarray(0, end - 1)
  if ((last & 0xc0) !== 0x80) return buffer
  let lead = end - 1
  while (lead > 0) {
    const byte = buffer[lead]
    if (byte === undefined || (byte & 0xc0) !== 0x80) break
    lead -= 1
  }
  const leadByte = buffer[lead]
  if (leadByte === undefined || leadByte < 0xc0 || leadByte > 0xf7) return buffer
  let sequenceLength: number
  if ((leadByte & 0xe0) === 0xc0) sequenceLength = 2
  else if ((leadByte & 0xf0) === 0xe0) sequenceLength = 3
  else if ((leadByte & 0xf8) === 0xf0) sequenceLength = 4
  else return buffer
  if (end - lead >= sequenceLength) return buffer
  return buffer.subarray(0, lead)
}

/**
 * Read one contained vault file with a byte cap; `truncated` flags the cut.
 * @param vaultPath - absolute path to the vault root.
 * @param relPath - vault-relative path to read.
 * @param maxBytes - maximum bytes to return (default 64 KiB).
 * @returns the file content truncated to maxBytes, plus whether the cut happened.
 * @throws when relPath escapes the vault or the file cannot be read.
 */
export async function readVaultFile(
  vaultPath: string,
  relPath: string,
  maxBytes = 64 * 1024,
): Promise<{ content: string; truncated: boolean }> {
  const abs = assertContained(vaultPath, relPath)
  await assertNoSymlinkSegments(vaultPath, abs)
  const buffer = await readFile(abs)
  const slice = buffer.subarray(0, maxBytes)
  const truncated = buffer.byteLength > maxBytes
  return { content: trimToCharBoundary(slice).toString('utf8'), truncated }
}

/**
 * Write the report; never overwrites an existing file (flag wx).
 * @param vaultPath - absolute path to the vault root.
 * @param reportDir - subdirectory under the vault that receives the report.
 * @param fileName - report file name.
 * @param content - Markdown content to write.
 * @returns the absolute path the report was written to.
 * @throws when the report already exists or the resolved path escapes the vault.
 */
export async function writeReport(
  vaultPath: string,
  reportDir: string,
  fileName: string,
  content: string,
): Promise<string> {
  const reportRoot = assertContained(vaultPath, reportDir)
  const abs = assertContained(vaultPath, join(reportDir, fileName))
  await assertNoSymlinkSegments(vaultPath, reportRoot)
  await assertNoSymlinkSegments(vaultPath, abs)
  await mkdir(reportRoot, { recursive: true })
  await assertNoSymlinkSegments(vaultPath, reportRoot)
  await assertNoSymlinkSegments(vaultPath, abs)
  if (Buffer.byteLength(content, 'utf8') > MAX_REPORT_BYTES) {
    throw new Error(`report exceeds maximum size of ${MAX_REPORT_BYTES} bytes`)
  }
  await writeFile(abs, content, { flag: 'wx' })
  return abs
}

/**
 * Whether the report file already exists. Non-missing errors are rethrown.
 * @param vaultPath - absolute path to the vault root.
 * @param reportDir - subdirectory under the vault that receives the report.
 * @param fileName - report file name.
 * @returns true when the report file exists; false only for ENOENT/ENOTDIR.
 */
export async function reportExists(vaultPath: string, reportDir: string, fileName: string): Promise<boolean> {
  const reportPath = assertContained(vaultPath, join(reportDir, fileName))
  await assertNoSymlinkSegments(vaultPath, reportPath)
  try {
    await stat(reportPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') {
      return false
    }
    throw error
  }
}
