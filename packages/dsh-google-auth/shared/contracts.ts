export interface Account {
  id: string
  email?: string
}
export interface IntegrationDefinition {
  readonly id: string
  readonly label: string
  readonly scopes: readonly string[]
}
export interface IntegrationStatus {
  id: string
  label: string
  scopes: string[]
  authorized: boolean
  missingScopes: string[]
}
export interface OAuthStatus {
  configured: boolean
  connected: boolean
  pending: boolean
  grantedScopes: string[]
  account?: Account
  expiresAt?: number
  error?: string
}
export interface AuthStatus {
  configured: boolean
  connected: boolean
  pending: boolean
  useSandbox?: boolean
  sandboxAvailable?: boolean
  account?: Account
  expiresAt?: number
  error?: string
  requiredScopes: string[]
  missingScopes: string[]
  integrations: IntegrationStatus[]
}
export interface Authorization {
  authorizationUrl: string
  expiresAt: number
}
export interface SettingsRequests {
  status: Record<string, never>
  connect: Record<string, never>
  cancel: Record<string, never>
  disconnect: Record<string, never>
  configure: { clientJson: string }
  'clear-config': Record<string, never>
  'callback-mode': { useSandbox: boolean }
}
export interface SettingsResults {
  status: AuthStatus
  connect: Authorization
  cancel: Record<string, never>
  disconnect: Record<string, never>
  configure: Record<string, never>
  'clear-config': Record<string, never>
  'callback-mode': Record<string, never>
}
export type SettingsAction = keyof SettingsRequests
// HTTP results remain unknown until their consuming component validates them.
export type SettingsRequest = <K extends SettingsAction>(
  action: K,
  ...body: K extends 'configure' | 'callback-mode'
    ? [body: SettingsRequests[K]]
    : [body?: SettingsRequests[K]]
) => Promise<unknown>
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
