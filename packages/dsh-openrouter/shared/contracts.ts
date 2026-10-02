export const CHANNEL = '/openrouter-integration'

/** Metadata only. A credential value never appears in a status or response. */
export interface OpenRouterStatus {
  configured: boolean
  writable: boolean
  source: string
  target: string | null
  reference?: string
  error?: string
}

export interface OpenRouterService {
  resolveApiKey(): Promise<string | undefined>
  status(): Promise<OpenRouterStatus>
}

export interface RpcEndpoints {
  status: { input: Record<string, never>; result: OpenRouterStatus }
  save: { input: { target: string; apiKey: string }; result: OpenRouterStatus }
  clear: { input: { target: string }; result: OpenRouterStatus }
}

export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: { message: string } }

/** DSH authenticates this private channel; the client validates response data. */
export interface RpcTransport {
  call(channel: string, endpoint: string, payload: unknown): Promise<unknown>
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isStatus(value: unknown): value is OpenRouterStatus {
  return (
    isObject(value) &&
    typeof value.configured === 'boolean' &&
    typeof value.writable === 'boolean' &&
    typeof value.source === 'string' &&
    (typeof value.target === 'string' || value.target === null) &&
    (value.reference === undefined || typeof value.reference === 'string') &&
    (value.error === undefined || typeof value.error === 'string')
  )
}
