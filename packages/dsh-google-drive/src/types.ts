// Narrow consumed host contracts. The auth sibling remains JavaScript during migration.
// These interfaces describe trusted in-process services, never browser-supplied agents.
export type Dispose = () => void
export type TokenOperation<T> = (token: string, signal?: AbortSignal) => Promise<T>
export type WithAccessToken = <T>(operation: TokenOperation<T>) => Promise<T>
export interface GoogleAuth {
  withAccessToken<T>(integration: string, operation: TokenOperation<T>): Promise<T>
  getAccessGeneration(): unknown
  onAccessChange(callback: () => void): Dispose
  status(): Promise<{ connected: boolean; integrations: { id: string; authorized: boolean }[] }>
  registerIntegration(input: { id: string; label: string; scopes: string[] }): Dispose
}
export interface Execution {
  agent: Owner
  callId: string
  signal?: AbortSignal | undefined
}
export interface Tool {
  name: string
  description: string
  parameters: object
  output: { schema: object; render(args: unknown, value: string): { type: string; text: string }[] }
  execute(args: unknown, exec: Execution): Promise<string>
}
export interface Skill {
  name: string
  description: string
  source: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  content: string
}
export interface AgentContext {
  get(key: 'tools'): { register(tool: Tool): Dispose } | undefined
  get(key: 'skills'): { register(skill: Skill): Dispose } | undefined
  effect(effect: () => Dispose): Dispose
}
export interface Owner {
  session: { id: string }
  ctx?: AgentContext
}
export interface Agents {
  get(id: string): Owner | undefined
  roots(): Owner[]
}
export interface Approval {
  overrideOf(session: Owner['session']): string | undefined
  config?: { policy?: string }
}
export interface ClientOptions {
  withAccessToken?: WithAccessToken | undefined
  fetch?: typeof globalThis.fetch | undefined
  requestTimeoutMs?: number | undefined
}
export interface FileMetadata {
  id: string
  name: string
  mimeType: string
  size?: string
  modifiedTime?: string
  webViewLink?: string
  parents?: string[]
  trashed?: boolean
}
export interface FilePage {
  files: FileMetadata[]
  nextPageToken?: string
}
export interface Resource extends FileMetadata {
  recursive: boolean
}
export interface SignalOptions {
  signal?: AbortSignal | undefined
}
export interface FileOptions extends SignalOptions {
  fileId?: string | undefined
}
export interface PdfOptions extends SignalOptions {
  startPage?: number | undefined
  endPage?: number | undefined
  ocr?: string | undefined
  languages?: string[] | undefined
  maxBytes?: number | undefined
}
export interface ReadOptions extends FileOptions, PdfOptions {}
export interface PickerOptions extends SignalOptions {
  parentId?: string | undefined
  search?: string | undefined
  view?: string | undefined
  pageSize?: number | undefined
  pageToken?: string | undefined
  query?: string | undefined
}
export interface ListOptions extends SignalOptions {
  folderId?: string | undefined
  pageSize?: number | undefined
  pageToken?: string | undefined
}
export interface TextResult {
  file: FileMetadata
  text: string
  mimeType: string
  format?: string
  pages?: { pageNumber: number; method: string }[]
  totalPages?: number
  actualRange?: { startPage: number; endPage: number }
  nextStartPage?: number
  warnings?: string[]
}
export interface DriveClient {
  pickerList(options: PickerOptions): Promise<FilePage>
  listFolder(options: ListOptions): Promise<FilePage>
  getMetadata(options: FileOptions): Promise<FileMetadata>
  readText(options: ReadOptions): Promise<TextResult>
}
export interface RequestOptions extends SignalOptions {
  callId: string
  reason: string
}
export interface BrowserInput {
  sessionId: string
  callId?: string | undefined
  requestId?: string | undefined
  parentId?: string | undefined
  search?: string | undefined
  view?: string | undefined
  pageToken?: string | undefined
  selected?: unknown
  ownerId?: string
  revision?: number
  enabled?: boolean
}
export interface SessionInput {
  sessionId: string
  ownerId?: string
  revision?: number
  enabled?: boolean
}
export type BrowserAction =
  | 'status'
  | 'browse'
  | 'grant'
  | 'deny'
  | 'manage'
  | 'revoke'
  | 'edit-status'
  | 'edit-browse'
  | 'edit-grant'
  | 'edit-deny'
  | 'edit-manage'
  | 'edit-revoke'
  | 'preview-status'
  | 'preview-apply'
  | 'preview-deny'
  | 'session-status'
  | 'session-set'
export type BrowserDispatch = (input: BrowserInput, signal?: AbortSignal) => unknown
export type BrowserRuntime = Record<BrowserAction, BrowserDispatch>
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function errorField(error: unknown, key: string): unknown {
  return isRecord(error) ? error[key] : undefined
}
