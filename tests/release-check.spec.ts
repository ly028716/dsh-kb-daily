import { describe, expect, it } from 'vitest'
import {
  assertReleaseMetadata,
  releaseTagForPackageVersion,
} from '../scripts/release-check.mjs'

describe('release metadata', () => {
  it('derives the annotated Git tag from a package version', () => {
    expect(releaseTagForPackageVersion('0.1.0-rc.8')).toBe('v0.1.0-rc.8')
  })

  it('rejects a tag that does not match package metadata', () => {
    expect(() => assertReleaseMetadata({
      version: '0.1.0-rc.8',
      tag: 'v0.1.0-rc.7',
      changelog: '## 0.1.0-rc.8',
    })).toThrow('does not match')
  })

  it('requires a changelog section for the release version', () => {
    expect(() => assertReleaseMetadata({
      version: '0.1.0-rc.8',
      tag: 'v0.1.0-rc.8',
      changelog: '## 0.1.0-rc.7',
    })).toThrow('CHANGELOG.md')
  })
})
