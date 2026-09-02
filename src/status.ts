import type { CheckOutcome } from './runner.ts'

/** Stable host service name for the single-vault RunnerControl. */
export const RUNNER_SERVICE = 'kbDailyRunner'

/** Resolve the host service name for a legacy or namespaced vault runner. */
export function runnerServiceName(id?: string): string {
  return id === undefined ? RUNNER_SERVICE : `${RUNNER_SERVICE}:${id}`
}

export type RunnerState = 'idle' | 'running' | 'succeeded' | 'already-done' | 'failed' | 'stopped'

export interface RunnerStatus {
  date: string
  state: RunnerState
  lastAttemptAt?: string
  lastError?: string
  reportPath?: string
}

export interface RunnerControl {
  runNow(): Promise<CheckOutcome>
  retry(date?: string): Promise<CheckOutcome>
  status(): RunnerStatus
}
