import type { GoogleAuthService } from '../../src/index.js'
import type { CallbackLease, CredentialAdapter } from '../../src/contracts.js'
declare const auth: GoogleAuthService
declare const credentials: CredentialAdapter
const result: Promise<{ account: string }> = auth.withAccessToken(
  'google-drive',
  async (token, signal) => {
    const bearer: string = token
    const cancelled: boolean = signal.aborted
    return { account: cancelled ? '' : bearer }
  },
)
void result
// @ts-expect-error Token issuance requires an explicit registered integration ID.
auth.getAccessToken()
// @ts-expect-error Account consent never accepts caller-selected scopes.
auth.begin({ scopes: ['openid'] })
// @ts-expect-error Access operations receive a token string, not a credential record.
auth.withAccessToken('google-drive', (token: { refreshToken: string }) => token)
// @ts-expect-error Publication ownership always includes an explicit disposer.
const lease: CallbackLease = { origin: 'http://127.0.0.1:1234' }
void lease
// @ts-expect-error Credential commit guards return booleans.
credentials.set({ accessToken: '', refreshToken: '', expiresAt: 0, scopes: [] }, () => 'yes')
