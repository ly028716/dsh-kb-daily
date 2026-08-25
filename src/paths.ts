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
 * lexically. Symlinks are not resolved: a vault-internal link that escapes
 * the vault is out of v1 scope.
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
