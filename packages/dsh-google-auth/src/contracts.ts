import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Authorization, OAuthStatus } from '../shared/contracts.js'
export interface ClientConfig {
  clientId: string
  clientSecret?: string | undefined
}
export interface TokenRecord {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scopes: string[]
  account?: { id: string; email?: string }
}
export interface CredentialAdapter {
  get(): Promise<unknown>
  set(tokens: TokenRecord, isValid?: () => boolean): Promise<unknown>
  delete(): Promise<unknown>
}
// Credentials are an external JSON boundary. The adapter validates its envelope;
// OAuth validates the stored grant before consuming any of its fields.
export interface CredentialProvider {
  readRecord(key: string): Promise<unknown>
  modifyRecord(
    key: string,
    update: (record: unknown) => Promise<{ kind: 'grant'; payload: object }>,
  ): Promise<unknown>
  deleteRecord(key: string): Promise<unknown>
}
export interface CallbackLease {
  origin: string
  dispose(): void | Promise<void>
}
export interface CallbackPublisher {
  available(): boolean
  publish(args: { port: number; signal?: AbortSignal }): Promise<CallbackLease>
}
export interface BeginOptions {
  scopes?: readonly string[]
  publishCallback?: (port: number, signal: AbortSignal) => Promise<CallbackLease>
}
export interface OAuthClient {
  status(): Promise<OAuthStatus>
  begin(options: BeginOptions): Promise<Authorization>
  getAccessToken(options: { scopes: readonly string[] }): Promise<string>
  cancel(options?: { force?: boolean }): boolean
  dispose(): void | Promise<void>
  cleanup?(): Promise<void>
}
// Narrow consumed Host contracts. This package does not depend on the optional
// Settings/bridge packages; real-profile tests verify their RC2 lifecycle surface.
export interface EffectContext {
  effect(factory: () => void | (() => void | Promise<void>)): unknown
  provide(name: string, value: unknown): unknown
}
export interface RouteContext {
  effect(factory: () => void | (() => void | Promise<void>)): unknown
  webServer: {
    port: number
    register(route: {
      kind: 'exact'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }): () => void
  }
}
export interface AuthContext extends EffectContext, RouteContext {
  credentials: CredentialProvider
  fiber: { entry: { options: { id: string } } }
  get(
    name: 'settings',
  ): { update(id: string, value: { useSandbox: boolean }): Promise<unknown> } | undefined
  get(name: 'sandboxCallbackPublisher'): CallbackPublisher | undefined
  on(name: 'loader/volatile-update', listener: () => void): unknown
  inject(
    names: ['settings'],
    callback: (
      child: EffectContext & {
        settings: { configure(options: { auto: false }, fiber: AuthContext['fiber']): () => void }
      },
    ) => unknown,
  ): unknown
}
