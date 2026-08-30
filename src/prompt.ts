/** System-prompt section name contributed by this plugin. */
export const KB_SECTION_NAME = 'kb-daily:task'

/** Configuration for the kb-daily system-prompt section. */
export interface SectionConfig {
  /** Subdirectory under the vault that receives daily reports. */
  reportDir: string
}

/**
 * Stable system-prompt guidance for the knowledge-base daily analyst.
 * @param config - section configuration, including the report directory.
 * @returns the system-prompt section text.
 */
export function sectionText(config: SectionConfig): string {
  return [
    'You are the knowledge-base daily analyst.',
    'Produce today\'s daily digest on request:',
    '1. Call kb_list_modified to find notes changed today (vault-local date).',
    '2. Read the changed notes with kb_read (vault-relative paths only).',
    `3. Write a concise Chinese Markdown report with kb_write_report; it lands in ${config.reportDir}/YYYY-MM-DD.md.`,
    'At the very beginning of the report, state the scan scope, the number of files returned, and whether the scan was truncated by a budget.',
    'Rules: never modify or delete source notes; never overwrite an existing report;',
    'list every changed file with its vault-relative path and a 1-3 sentence summary each.',
  ].join('\n')
}

/**
 * Follow-up message that starts one daily catch-up run.
 * @param date - target date as YYYY-MM-DD.
 * @returns the task-framing message text.
 */
export function taskFraming(date: string): string {
  return [
    `[KB DAILY TASK] Today is ${date}.`,
    'Generate today\'s knowledge-base daily report now: list modified notes, read them, and write the report.',
    'If no notes changed today, still write a short report stating that.',
  ].join('\n')
}
