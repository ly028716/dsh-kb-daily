import type { CheckOutcome } from './runner.ts'

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
