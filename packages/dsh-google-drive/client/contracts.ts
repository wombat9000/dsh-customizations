import type { BrowserAction, BrowserInput, FileMetadata } from '../src/types.js'
export type { BrowserAction, FileMetadata }
export type AccessAction = 'status' | 'browse' | 'grant' | 'deny' | 'manage' | 'revoke'
export type AccessMode = 'read' | 'edit'
export interface RpcContracts {
  'session-status': { sessionId: string }
  'session-set': { sessionId: string; ownerId: string; revision: number; enabled: boolean }
}
export type Api = <M extends BrowserAction>(
  method: M,
  body: M extends keyof RpcContracts ? RpcContracts[M] : BrowserInput,
  signal?: AbortSignal,
) => Promise<unknown>
export type SessionStatus =
  | { available: false; enabled: false }
  | { available: true; enabled: boolean; ownerId: string; revision: number }
export interface Resource {
  id: string
  recursive: boolean
  name?: string
  mimeType?: string
}
export interface AccessStatus {
  state: 'pending' | 'granted' | 'denied' | 'cancelled' | 'none'
  grants: Resource[]
  reason?: string
  requestId?: string
  mode?: AccessMode
}
export interface Listing {
  files: FileMetadata[]
  nextPageToken?: string
}
export interface PickerEntry {
  owner: object
  sessionId: string
  callId: string
  status: AccessStatus
  mode: AccessMode
  request: Api
  onChanged: () => void
}
export interface PickerStore {
  getSnapshot: () => PickerEntry | null
  subscribe: (callback: () => void) => () => void
  open: (entry: PickerEntry) => void
  close: () => void
  closeOwner: (owner: object) => void
}
export interface CardProps {
  sessionId: string
  callId: string
  picker: PickerStore
  request?: Api
  mode?: AccessMode
}
export type PreviewState =
  | 'preparing'
  | 'pending'
  | 'applying'
  | 'applied'
  | 'denied'
  | 'cancelled'
  | 'expired'
  | 'stale'
  | 'failed'
  | 'uncertain'
// The browser checks addresses and bounds, then narrows optional cell values at rendering time.
export interface PreviewCell {
  cell: string
  userEnteredValue?: unknown
  userEnteredFormat?: unknown
}
export interface Preview {
  fileId: string
  fileName?: unknown
  range: string
  tab: { title: string }
  before: { cells: PreviewCell[] }
  after: { cells: PreviewCell[] }
}
export interface PreviewStatus {
  state: PreviewState
  requestId: string
  preview?: Preview
  result?: unknown
}
export type PreviewAction = 'preview-apply' | 'preview-deny'
export interface PreviewCardProps {
  sessionId: string
  callId: string
  request?: Api
}
export interface PreviewDialogProps {
  status: PreviewStatus & { preview: Preview }
  busy: boolean
  error: string
  act: (method: PreviewAction) => void
  close: () => void
}
export const FOLDER = 'application/vnd.google-apps.folder'
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function errorName(error: unknown): unknown {
  return isRecord(error) ? error.name : undefined
}
export function errorMessage(error: unknown): string {
  return isRecord(error) && typeof error.message === 'string' ? error.message : ''
}
export function endpoint(
  mode: AccessMode,
  action: AccessAction,
): AccessAction | `edit-${AccessAction}` {
  return mode === 'edit' ? `edit-${action}` : action
}
