import type { SettingsRequest, SettingsResults } from '../../shared/contracts.js'
declare const request: SettingsRequest
void request('status')
void request('configure', { clientJson: '{}' })
void request('callback-mode', { useSandbox: true })
// @ts-expect-error Callback preferences are booleans.
void request('callback-mode', { useSandbox: 'true' })
// @ts-expect-error Configuration requires its write-only payload.
void request('configure')
// @ts-expect-error Consent accepts no caller-selected scopes or integration IDs.
void request('connect', { integrationId: 'drive', scopes: ['openid'] })
// @ts-expect-error There is no browser token endpoint.
void request('getAccessToken')
declare const status: SettingsResults['status']
// @ts-expect-error Status does not expose credentials.
void status.refreshToken
