export const CHANNEL = '/jev-integration'

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type JevQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }
export interface JevRequest {
  state: string | JsonValue[] | { [key: string]: JsonValue }
  questions: Record<string, JevQuestion>
  signal?: AbortSignal
}
export type JevAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
  | {
      type: 'score'
      score: number
      confidence: number
      probabilities: Record<string, number>
      legend: Record<string, string>
    }
export interface JevResult {
  model: string
  answers: Record<string, JevAnswer>
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number }
}
export type JevErrorCode =
  | 'invalid'
  | 'model'
  | 'credential'
  | 'network'
  | 'response'
  | 'timeout'
  | 'cancelled'
  | 'stopped'
  | 'busy'
  | 'changed'
  | 'settings'
export interface JevStatus {
  model: string
  available: boolean
  credential: {
    configured: boolean
    writable: boolean
    source: string
    target?: null
    error?: string
  }
}
export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: JevErrorCode; message: string; details: Record<string, never> } }
export interface RpcEndpoints {
  status: { input: Record<string, never>; result: JevStatus }
  configure: { input: { model: string }; result: JevStatus }
}
export interface JevService {
  evaluate(input: JevRequest): Promise<JevResult>
  settings(): { model: string }
  status(): Promise<JevStatus>
}
