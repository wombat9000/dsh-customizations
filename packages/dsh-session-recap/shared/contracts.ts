// Type-only descriptions of host-validated wire values. Host validation stays in src/.
export interface Settings {
  autoRecap: boolean
  useJev: boolean
  inactivityMinutes: number
  provider: string
  model: string
}
export interface ScopedSettings extends Settings { storageScope: string }
export type CardLabel = 'direction' | 'decision' | 'insight' | 'question' | 'next_step' | 'paused'
export interface RecapCard { readonly label: CardLabel; readonly text: string }
export interface BulletRecap {
  readonly headline?: string
  readonly bullets: readonly string[]
  readonly cards?: never
}
export interface CardRecap {
  readonly headline: string
  readonly cards: readonly RecapCard[]
  readonly bullets?: never
}
export type Recap = BulletRecap | CardRecap
export interface SelectionThresholds {
  readonly support: number
  readonly usefulness: number
  readonly confidence: number
  readonly maxCards: number
}
export type SelectionReason = 'support' | 'usefulness' | 'confidence' | 'invalid-answer' | 'ranked-out'
export interface SelectionCategory {
  readonly label: CardLabel
  readonly support: number | null
  readonly usefulness: number | null
  readonly confidence: number | null
  readonly probabilities: Readonly<Partial<Record<'0' | '1' | '2' | '3', number>>> | null
  readonly selected: boolean
  readonly reasons: readonly SelectionReason[]
}
export type SelectionQuestion =
  | { readonly type: 'noul'; readonly instructions: string; readonly criteria: Readonly<{ true: string; false: string }> }
  | { readonly type: 'score'; readonly instructions: string; readonly criteria: readonly string[] }
export interface SelectionDiagnostics {
  readonly version: 1
  readonly questionSetVersion: string
  readonly model: string | null
  readonly thresholds: SelectionThresholds
  readonly questions: Readonly<Record<string, SelectionQuestion>>
  readonly categories: readonly SelectionCategory[]
  readonly status: 'evaluated' | 'unavailable'
}
export type Selection =
  | { readonly mode: 'standard'; readonly reason?: 'unavailable' | 'no-labels'; readonly diagnostics?: SelectionDiagnostics }
  | { readonly mode: 'jev'; readonly diagnostics: SelectionDiagnostics; readonly reason?: never }
export interface RecapResult {
  readonly sessionId: string
  readonly revision: number
  readonly recap: Recap
  readonly selection: Selection
  readonly generatedAt: string
  readonly cached: boolean
}
export interface ActivityResult { ready: boolean; running: boolean; latestActivity: number | null }
export interface ModelOption { id: string; name: string }
export interface ProviderOption { id: string; name: string; models: readonly ModelOption[] }
export interface ModelsResult { providers: readonly ProviderOption[] }
export interface RpcError { code: string; message: string; details: Readonly<Record<string, unknown>> }
export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: RpcError }
export interface RpcEndpoints {
  settings: { payload: Record<string, never>; result: ScopedSettings }
  configure: { payload: Partial<Settings>; result: ScopedSettings }
  models: { payload: Record<string, never>; result: ModelsResult }
  activity: { payload: { sessionId: string }; result: ActivityResult }
  recap: { payload: { sessionId: string; automatic?: boolean }; result: RecapResult }
}
export interface Rpc {
  call<E extends keyof RpcEndpoints>(channel: '/session-recap', endpoint: E, payload: RpcEndpoints[E]['payload']): Promise<RpcResult<RpcEndpoints[E]['result']>>
}
