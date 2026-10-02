import type { CredentialInfo } from '@deepseek-ai/dsh-api-remotes/client'
import type { CredentialAPI } from '../../shared/contracts.js'

declare const api: CredentialAPI
void api.credentials.describe(['FIRECRAWL_API_KEY']).then((response) => {
  if (response.ok) {
    const info: CredentialInfo | undefined = response.value.FIRECRAWL_API_KEY
    // @ts-expect-error Credential descriptions do not return secret values.
    void info?.value
  } else {
    // @ts-expect-error Failed RPCs do not carry successful values.
    void response.value
  }
})
// @ts-expect-error Credential writes accept only string values.
void api.credentials.set('FIRECRAWL_API_KEY', 123)
// @ts-expect-error describe receives a list of references, not a single reference.
void api.credentials.describe('FIRECRAWL_API_KEY')
