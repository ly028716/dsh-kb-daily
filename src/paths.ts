import { lstat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * Absolute report path: vault/reportDir/fileName. Callers must ensure reportDir and fileName are trusted or already validated.
 * @param vaultPath - absolute path to the vault root.
 * @param reportDir - subdirectory under the vault that receives the report.
 * @param fileName - report file name.
 * @returns the absolute report path.
 */
export function resolveReportPath(vaultPath: string, reportDir: string, fileName: string): string {
  return join(vaultPath, reportDir, fileName)
}

/**
 * Resolve a vault-relative path; reject anything that escapes the vault
 * lexically. Callers that access the filesystem must also use
 * assertNoSymlinkSegments() to enforce physical containment.
 * @param vaultPath - absolute path to the vault root.
 * @param relPath - vault-relative path to resolve.
 * @returns the resolved absolute path inside the vault.
 * @throws when the resolved path falls outside the vault.
 */
export function assertContained(vaultPath: string, relPath: string): string {
  const root = resolve(vaultPath)
  const candidate = resolve(root, relPath)
  const rel = relative(root, candidate)
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error(`path escapes the vault: ${relPath}`)
  }
  return candidate
}

/**
 * Reject physical paths that pass through a symbolic-link or junction segment.
 * Missing tail segments are allowed so callers can validate a future path before
 * creating it.
 * @param vaultPath - absolute path to the vault root.
 * @param absolutePath - absolute path already resolved under the vault.
 * @throws when any existing path segment is a symbolic link.
 */
export async function assertNoSymlinkSegments(vaultPath: string, absolutePath: string): Promise<void> {
  const root = resolve(vaultPath)
  const candidate = resolve(absolutePath)
  const rel = relative(root, candidate)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error(`path escapes the vault: ${absolutePath}`)
  }

  const check = async (path: string): Promise<boolean> => {
    try {
      const info = await lstat(path)
      if (info.isSymbolicLink()) {
        throw new Error(`path contains a symbolic link: ${path}`)
      }
      return true
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return false
      throw error
    }
  }

  if (!await check(root)) return
  if (rel === '') return

  let current = root
  for (const segment of rel.split(/[\\/]+/)) {
    if (!segment) continue
    current = join(current, segment)
    if (!await check(current)) return
  }
}
