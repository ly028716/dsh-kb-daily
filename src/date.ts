/** Format a Date as YYYY-MM-DD in an explicit IANA time zone. */
export function dateKey(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const field = (type: string): string | undefined =>
    /* v8 ignore next -- 'en-US' with explicit year/month/day always yields those fields */
    parts.find(part => part.type === type)?.value
  return `${field('year')}-${field('month')}-${field('day')}`
}

/** Return the UTC millisecond instant corresponding to local midnight. */
export function dateStartMs(date: string, timeZone: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`date must be YYYY-MM-DD, got ${date}`)
  }
  const probe = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(probe) || dateKey(new Date(probe), 'UTC') !== date) {
    throw new Error(`invalid calendar date: ${date}`)
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  for (const sample of [probe, probe + 12 * 60 * 60 * 1000, probe - 12 * 60 * 60 * 1000]) {
    const parts = formatter.formatToParts(new Date(sample))
    const value = (type: string): number => Number(parts.find(part => part.type === type)?.value)
    const representedAsUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'))
    const candidate = sample - (representedAsUtc - sample)
    if (dateKey(new Date(candidate), timeZone) === date) return candidate
  }
  throw new Error(`could not resolve local midnight for ${date} in ${timeZone}`)
}

/** Report file name for a date key. */
export function reportFileName(date: string): string {
  return `${date}.md`
}
