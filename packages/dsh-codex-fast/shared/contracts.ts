export const CHANNEL = '/codex-fast-integration'
export const COST_NOTICE =
  'Fast mode uses subscription limits at a higher rate (currently 2.5× included usage). Availability depends on your OpenAI plan and model.'

export interface IntegrationStatus {
  enabled: boolean
  revision: number
  available: boolean
  error: string | null
}
export interface FastStatus extends IntegrationStatus {
  sessionId: string
  provider: string
  model: string
  requested: boolean
  supported: boolean
  sessionRevision: number
  observation: 'none' | 'requested' | 'error'
  notice: string | null
}
export interface RpcEndpoints {
  'integration-status': { input: Record<string, never>; result: IntegrationStatus }
  'integration-set': { input: { enabled: boolean; revision: number }; result: IntegrationStatus }
  'session-status': { input: { sessionId: string }; result: FastStatus }
  'session-set': {
    input: {
      sessionId: string
      provider: string
      model: string
      enabled: boolean
      revision: number
    }
    result: FastStatus
  }
}
export interface RpcTransport {
  call<T>(
    channel: string,
    endpoint: string,
    payload?: unknown,
  ): Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function isIntegrationStatus(value: unknown): value is IntegrationStatus {
  return (
    isObject(value) &&
    typeof value.enabled === 'boolean' &&
    Number.isSafeInteger(value.revision) &&
    typeof value.available === 'boolean' &&
    (value.error === null || typeof value.error === 'string')
  )
}
export function isFastStatus(value: unknown): value is FastStatus {
  return (
    isIntegrationStatus(value) &&
    isObject(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.provider === 'string' &&
    typeof value.model === 'string' &&
    typeof value.requested === 'boolean' &&
    typeof value.supported === 'boolean' &&
    Number.isSafeInteger(value.sessionRevision) &&
    ['none', 'requested', 'error'].includes(String(value.observation)) &&
    (value.notice === null || typeof value.notice === 'string')
  )
}
