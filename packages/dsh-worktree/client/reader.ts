import {
  CHANNEL,
  type SnapshotValue,
  type Selection,
  type WorktreeRpc,
} from '../shared/contracts.ts'
export interface ReaderState {
  value?: SnapshotValue | undefined
  loading: boolean
  error?: string
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

// The package-owned host projects the nested snapshot fields. Connection
// transports them verbatim; this envelope/state gate preserves the existing
// client trust boundary. Snapshot list presence is checked by the reader.
function hasSnapshotEnvelope(
  value: Record<string, unknown>,
  sessionId: string,
): value is Record<string, unknown> & SnapshotValue {
  return (
    value.sessionId === sessionId &&
    typeof value.state === 'string' &&
    ['ready', 'disabled', 'unavailable', 'error'].includes(value.state)
  )
}

export function unwrap(input: unknown, sessionId: string): SnapshotValue {
  const result = record(input)
  // Do not display transport or server error strings: they can contain host
  // details. A failed or malformed read is not an empty worktree list.
  if (result?.ok !== true) throw new Error('Worktrees RPC failed.')
  const value = record(result.value)
  if (!hasSnapshotEnvelope(value, sessionId)) throw new Error('Invalid Worktrees response.')
  return value
}

// One mounted view, no session cache. Generations discard superseded reads.
export function createReader(
  rpc: WorktreeRpc,
  sessionId: string,
  publish: (state: ReaderState) => void,
) {
  let generation = 0
  let disposed = false
  let selection: Selection = {}
  let value: SnapshotValue | undefined
  return {
    async refresh(next: Selection = selection) {
      selection = next
      const token = ++generation
      publish({ value, loading: true })
      try {
        const result = unwrap(
          await rpc.call(CHANNEL, 'snapshot', { sessionId, ...selection }),
          sessionId,
        )
        if (disposed || token !== generation) return
        if (
          result.state === 'error' ||
          (result.state === 'ready' && !Array.isArray(result.worktrees))
        )
          throw new Error('Invalid Worktrees snapshot.')
        // Pin server defaults once resolved. Keep missing explicit selections
        // unavailable; an empty history may still resolve its first run later.
        if (result.state === 'ready' && result.selected) {
          selection = { ...selection, path: result.selected.path }
          if (result.selected.run) selection.runId = result.selected.run.id
        }
        value = result
        publish({ value, loading: false })
      } catch {
        if (!disposed && token === generation)
          publish({ loading: false, error: 'Worktrees could not refresh. Try again.' })
      }
    },
    dispose() {
      disposed = true
      generation++
    },
  }
}
