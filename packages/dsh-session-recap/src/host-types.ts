import type { SelectionQuestion, Settings } from '../shared/contracts.js'

// Consumed injected-service surfaces, not substitutes for complete DSH APIs.
// RC2 supplies these services; Recap does not own their construction. Keeping this
// boundary structural also permits the existing deterministic host fixtures.
export interface HistoryMessage {
  role: string
  source?: { kind: string } | undefined
  content: readonly { type: string; text?: unknown }[]
}
export interface HistoryRow {
  role: string
  text: string
  omittedBefore?: number
  truncated?: boolean
}
export interface SessionEvent {
  type: string
  time: number
  data: { source?: { kind: string } | undefined }
}
export interface RecapSession {
  seq: number
  deriveMessages(): readonly HistoryMessage[]
  snapshotEvents?(): Iterable<SessionEvent>
}
export interface Sessions {
  get(id: string): RecapSession | undefined
}
export interface CallConfig {
  provider: string
  model: string
  maxTokens?: number
}
// Consumed fields of the seven RC2 StreamChunk variants (dsh-llm/types).
// No copied provider implementation or runtime import is needed at this boundary.
export type StreamChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'finish'; reason: { kind: string } }
  | { type: 'block-start'; blockType: string }
  | { type: 'block-end'; block: { type: string } }
  | { type: 'tool-call-delta' | 'reasoning-delta' | 'usage' }
export interface PreparedCall {
  config: CallConfig
  inputModalities?: readonly string[]
  stream(
    options: CallConfig & {
      signal: AbortSignal
      tools: readonly never[]
      system: string
      messages: readonly (HistoryMessage & { id: string })[]
    },
  ): AsyncIterable<StreamChunk>
}
export interface Writer {
  prepareCall(config: CallConfig, signal: AbortSignal): Promise<PreparedCall>
}
export interface ModelCatalog extends Writer {
  listProviders(): readonly { id: string; name: string }[]
  listModels(provider: string): Promise<readonly { id: string; name: string }[]>
}
export interface JevService {
  settings(): { model?: unknown }
  evaluate(request: {
    state: { conversation: readonly HistoryRow[] }
    questions: Readonly<Record<string, SelectionQuestion>>
    signal: AbortSignal
  }): Promise<unknown>
}
export interface JevContext {
  identity: string | null
  service?: JevService
}
export interface RuntimeOptions {
  sessions: Sessions
  llm: Writer
  settings(): Settings
  getJev?(): unknown
  timeoutMs?: number
}

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
