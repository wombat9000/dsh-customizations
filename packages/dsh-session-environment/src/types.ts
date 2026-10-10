import type { SessionId } from '@deepseek-ai/dsh-session/types'

export type CIState =
  | 'pending'
  | 'running'
  | 'failure'
  | 'success'
  | 'cancelled'
  | 'skipped'
  | 'neutral'
  | 'stale'
  | 'unknown'
  | 'no-checks'

// Narrow consumed host contract for localGitHubLiveCI. Keep this adapter optional:
// Environment neither loads GitHub nor owns credentials/provider normalization.
export interface CICheckout {
  cwd: string
  root: string
  branch: string | null
  head: string | null
  remotes: string[]
}
export interface CICheck {
  name: string
  state: Exclude<CIState, 'no-checks'>
}
export interface CIRow {
  kind: 'current' | 'default'
  label: string
  sha: string | null
  url: string | null
  state: CIState
  complete: boolean
  count: number
  // Older optional GitHub providers may supply only the aggregate status.
  checks?: CICheck[]
  mismatch: boolean
  warning: string | null
}
export interface CISnapshot {
  rows: CIRow[]
  checkedAt: number
  refreshAfterMs: number
  freshUntil: number
  error: string | null
  stale: boolean
}
export interface SessionCIRequest {
  readonly sessionId: SessionId
  readonly checkoutKey: string
}
export interface SessionCISnapshot extends CISnapshot {
  checkoutKey: string
}

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
  readonly checkoutKey?: string
  readonly error?: string
}
