import type { Recap, Rpc, Selection, ScopedSettings } from '../shared/contracts.ts'

// Empty and partial snapshots are intentional; booleans reflect independent UI transitions.
export interface ControllerSnapshot {
  busy?: boolean | undefined
  error?: string | undefined
  unread?: boolean | undefined
  open?: boolean | undefined
  openOnReady?: boolean | undefined
  recap?: Recap | undefined
  selection?: Selection | undefined
}
export interface SessionObservation { ready: boolean; running: boolean; latestTurn?: number | undefined }
export type SnapshotListener = (snapshot: ControllerSnapshot) => void
export interface SessionState {
  value: ControllerSnapshot
  listeners: Set<SnapshotListener>
  pending: Promise<void> | null
  generation: number
  observation?: SessionObservation
}
export interface ActivityStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
export interface EventSource {
  addEventListener(event: string, listener: () => void): void
  removeEventListener(event: string, listener: () => void): void
}
export interface MountEnvironment {
  document: EventSource & { readonly visibilityState: string; hasFocus?: () => boolean }
  window: EventSource
}
export interface ControllerOptions {
  rpc: Rpc
  storage?: ActivityStorage | undefined
  now?: (() => number) | undefined
}
export interface Controller {
  mount(sessionId: string, environment: MountEnvironment, listener: SnapshotListener): () => void
  recap(sessionId: string, automatic?: boolean): Promise<void>
  click(sessionId: string): Promise<void> | null | undefined
  turnStarted(sessionId: string): void
  observeSession(sessionId: string, observation: SessionObservation): void
  getSnapshot(sessionId: string): ControllerSnapshot
  subscribe(sessionId: string, listener: SnapshotListener): () => boolean
  invalidateSettings(): void
  humanMessageSent(sessionId: string): void
}
export interface ActivityStore {
  key(config: ScopedSettings, sessionId: string): string | undefined
  read(key: string | undefined): number | undefined
  touch(key: string | undefined): void
}
export interface ReturnTrackerOptions extends MountEnvironment {
  sessionId: string
  rpc: Rpc
  settings: () => Promise<ScopedSettings>
  activityStore: ActivityStore
  now: () => number
  state: SessionState
  publish: (session: SessionState, value: ControllerSnapshot) => void
  recap: Controller['recap']
}
