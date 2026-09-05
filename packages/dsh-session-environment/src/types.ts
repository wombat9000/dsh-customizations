import type { SessionId } from '@deepseek-ai/dsh-session/types'

export interface SessionEnvironmentRequest {
  readonly sessionId: SessionId
}

export interface SessionEnvironmentSnapshot {
  readonly cwd: string | null
  readonly home: string
  readonly repo: boolean | null
  readonly hasHead: boolean | null
  readonly branch: string | null
  readonly upstream: string | null
  readonly ahead: number | null
  readonly behind: number | null
  readonly dirtyFiles: number | null
  readonly additions: number | null
  readonly deletions: number | null
  readonly error?: string
}
