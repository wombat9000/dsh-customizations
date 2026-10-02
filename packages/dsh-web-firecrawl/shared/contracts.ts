import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'

export const CREDENTIAL_REF = 'FIRECRAWL_API_KEY'
// The generated RC2 Remote owns RPC validation and its result envelope.
// Keep the consumed surface narrow; the form never receives secret values.
export interface CredentialAPI {
  credentials: Pick<ClientRemote['credentials'], 'describe' | 'set' | 'unset'>
}
export type Subscribe = (listener: () => void) => () => void
