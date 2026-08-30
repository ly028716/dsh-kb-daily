import { describe, expect, it } from 'vitest'
import { sectionText, taskFraming } from '../src/prompt.ts'

describe('kb-daily prompt content', () => {
  it('section text names the tools and report location', () => {
    const text = sectionText({ reportDir: 'Daily' })
    expect(text).toContain('kb_list_modified')
    expect(text).toContain('kb_read')
    expect(text).toContain('kb_write_report')
    expect(text).toContain('Daily/YYYY-MM-DD.md')
    expect(text).toContain('never modify or delete source notes')
    expect(text).toContain('scan scope')
    expect(text).toContain('number of files returned')
    expect(text).toContain('scan was truncated')
    expect(text).toContain('YAML frontmatter')
    expect(text).toContain('generated_by: dsh-kb-daily')
    expect(text).toContain('今日概览')
    expect(text).toContain('变更文件')
    expect(text).toContain('vault-relative paths')
  })
  it('task framing carries the target date', () => {
    const framing = taskFraming('2026-08-17')
    expect(framing).toContain('2026-08-17')
    expect(framing).toContain('KB DAILY TASK')
  })
})
