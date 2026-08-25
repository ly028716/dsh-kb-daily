import { describe, expect, it } from 'vitest'
import { dateKey, dateStartMs, reportFileName } from '../src/date.ts'

describe('kb-daily date helpers', () => {
  it('formats a Date as YYYY-MM-DD in an explicit IANA zone', () => {
    const instant = new Date('2026-08-17T02:00:00Z')
    expect(dateKey(instant, 'UTC')).toBe('2026-08-17')
    expect(dateKey(instant, 'Asia/Shanghai')).toBe('2026-08-17')
    expect(dateKey(instant, 'America/Los_Angeles')).toBe('2026-08-16')
  })
  it('builds the report file name', () => {
    expect(reportFileName('2026-08-17')).toBe('2026-08-17.md')
  })
  it('computes the local start of a date across a timezone boundary', () => {
    const start = dateStartMs('2026-08-17', 'Asia/Shanghai')
    expect(dateKey(new Date(start), 'Asia/Shanghai')).toBe('2026-08-17')
    expect(start).toBe(Date.parse('2026-08-16T16:00:00Z'))
  })
  it('rejects invalid date keys and timezones', () => {
    expect(() => dateStartMs('yesterday', 'UTC')).toThrow(/YYYY-MM-DD/)
    expect(() => dateKey(new Date(), 'Not/AZone')).toThrow()
  })
})
