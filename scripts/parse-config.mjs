import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseDocument } from 'yaml'

const projectRoot = resolve(import.meta.dirname, '..')
const configFiles = [
  '.github/workflows/ci.yml',
  '.github/dependabot.yml',
  'pnpm-workspace.yaml',
]

for (const relativePath of configFiles) {
  const absolutePath = resolve(projectRoot, relativePath)
  const document = parseDocument(readFileSync(absolutePath, 'utf8'))

  if (document.errors.length > 0) {
    throw new Error(`${relativePath}: ${document.errors.map(error => error.message).join('; ')}`)
  }

  const value = document.toJS()
  if (value === null || typeof value !== 'object') {
    throw new Error(`${relativePath}: expected a YAML mapping or sequence`)
  }

  console.log(`${relativePath}: ok`)
}
