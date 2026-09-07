# Google accounts

`@local/dsh-google-auth` is the shared Google authentication provider for DSH. It owns Desktop OAuth client configuration, account identity, consent, credential storage, and token refresh. Integrations such as [Google Drive](../dsh-google-drive/README.md) declare their required permissions and consume the host's `googleAuth` service instead of implementing login themselves.

## First-version boundaries

- One connected Google account and one Desktop OAuth client per DSH credential store. Sessions and profiles sharing that store share the account. Use one active DSH host to manage the connection; cross-process refresh coordination is not implemented.
- Direct callbacks require a browser on the same host as DSH. Docker Sandbox users can enable **Use sandbox callback forwarding** to publish the callback on Mac loopback through the optional deployment bridge. Arbitrary remote-browser callbacks are not supported.
- Installing an integration only registers its permission requirements. It does not initiate login, refresh tokens, or request consent.
- This package exposes no model tools. Tokens never enter HTTP responses, settings documents, or model tool results. The underlying DSH credential provider controls storage at rest; this package does not guarantee encryption.
- Gmail and GCP integrations are not included. Neither package installs or executes `gws`.

## Configure and connect

Before deployment, create a Google **Desktop app** OAuth client and enable the APIs required by your selected integrations. Keep the downloaded JSON outside Git. For a testing-mode OAuth application, add your account as a test user. Organization policies may require administrator approval for requested permissions.

Installation and profile application require approval; follow the repository's [setup procedure](../../README.md#apply-the-starter-profile). The personal-web recipe installs Google auth before Google Drive. Applying the recipe does not change existing sessions' tools.

1. After an approved installation, restart the existing DSH profile and refresh its Web page.
2. Open **Settings → Plugins → Google accounts**.
3. Paste the downloaded Desktop JSON in the write-only field and choose **Save client configuration**. The provider stores only `installed.client_id` and the optional `installed.client_secret`. It ignores supplied endpoint URLs and never returns the saved JSON to the browser.
4. If DSH runs inside Docker Sandbox, enable **Use sandbox callback forwarding**. Leave it off when DSH runs directly on your computer. See [Callback routing](#callback-routing) for prerequisites.
5. Review an integration's required scopes, then choose its **Connect** action.
6. Follow **Continue with Google** and approve the requested access. The card shows the connected account and each integration's permission status.

When a newly installed integration needs more permissions, its card lists the missing scopes. Choose **Grant additional permissions** for that integration to start another consent flow. Installing it or calling its tools cannot silently start that flow. The provider requests the union of existing granted scopes, the selected integration's scopes, and identity scopes. A token is returned only if the current grant covers the requesting integration.

Account identity comes from Google's authenticated userinfo endpoint, not from an unverified JWT. Incremental consent must return the same stable Google account ID. To switch accounts, disconnect first. The provider requests `openid` and Google email identity access so it can bind grants to the account and display a verified email when available. It normalizes Google's `email`/`profile` scope aliases when comparing grants.

## Callback routing

**Use sandbox callback forwarding** is off by default. It is the non-secret `google-auth.useSandbox` setting and persists in DSH settings, independently of client configuration and tokens. Changing it cancels a pending login without clearing the connected account. If a credential commit has already started, wait for it to finish before changing the mode. Start a fresh login after a mode change; an old authorization link is no longer valid.

- **Off:** Bind an ephemeral `127.0.0.1` listener and use that direct address. No bridge import or publication occurs. The browser and DSH must run on the same host.
- **On:** Bind the internal listener, publish its port through the deployment bridge, then generate the Google authorization URL using the returned Mac loopback origin. The same public redirect URI is used for callback validation and code exchange. Publication must succeed before a login link is returned; there is no direct-mode fallback.

Sandbox mode requires the existing `@local/dsh-sbx-bridge` deployment package and its running macOS helper. The adapter uses the package's exported `BridgeClient` API, tested against its `0.1.0` contract. It detects that package at runtime rather than requesting the unpublished local package from a registry. Direct-host installations do not need it. The adapter uses `${DSH_HOME:-$HOME/.dsh}/sbx-bridge`; deployments with a different location can set `bridgeDir` on the `@local/dsh-google-auth/sandbox` composition row.

The bundle contributes that optional adapter as the host service `sandboxCallbackPublisher`. Its `available()` check tests module resolution, not helper health. `publish({ port, signal })` returns an owned `{ origin, dispose }` lease. The signal cancels publication setup; after handoff, the caller releases the lease explicitly so callback responses can finish before forwarding closes. Each lease owns a separate bridge client and cannot close unrelated preview-tool publications. The bridge receives only the port and a fixed label, never OAuth state, callback paths, codes, or tokens.

Completion, denial, failure, cancellation, timeout, and plugin disposal release the callback publication. The engine allows the callback response to drain before releasing an established relay. Cleanup failures produce a sanitized status error rather than an unhandled rejection. If the bridge is unavailable or its helper fails, Settings reports an error before browser authorization starts. Check the helper or turn the option off only when the browser can reach DSH's direct loopback listener.

This change does not modify or restart the host sandbox manager, and it does not recreate a sandbox. After an approved deployment/restart and page refresh, enable the checkbox and test a new login. A previous `127.0.0.1` redirect failure does not require a new Google client or new credentials.

## Remove access

**Disconnect** removes the local token record for every integration but retains the Desktop client configuration. **Remove client configuration** removes both records. Replacing the client configuration also clears the shared connection. These actions cancel pending operations and do not revoke Google's grant.

Cancellation works before credential commit. Once the credential store starts committing the grant, cancellation reports that sign-in is finishing; wait for completion, then disconnect if needed. To revoke the grant at Google, use your Google account's third-party access settings. Revocation can affect all applications reusing that OAuth client.

Removing an integration unregisters its consumer and prevents it from obtaining tokens. It does not remove already granted scopes from Google's account/client grant. A reused grant may contain broader permissions than an individual integration needs. Registration and scope checks are a contract between trusted host plugins, not a sandbox against malicious plugin code. Use separate OAuth clients and isolated credential stores if you need stronger separation; this version has no per-integration client selector.

## Host integration contract

The auth provider belongs in the host composition and injects `credentials`, `webServer`, and `settings`. It serves the `google-auth` settings namespace with the non-secret `useSandbox` preference so DSH displays the Google accounts card. Client configuration and tokens stay outside that settings document.

An integration also belongs on the host when it serves consumers across sessions. It declares `inject: ['googleAuth']` and registers one stable ID:

```js
export const inject = ['googleAuth']

export function apply(ctx) {
  ctx.effect(() => ctx.googleAuth.registerIntegration({
    id: 'gmail',
    label: 'Gmail',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  }))
  // Register Gmail business APIs/tools separately. This declaration alone
  // performs no login, token access, or Google API request.
}
```

The Gmail declaration is an example, not a shipped integration.

| Host method | Contract |
| --- | --- |
| `registerIntegration({ id, label, scopes })` | Declares explicit Google scopes and returns a disposer. IDs are unique, lowercase hyphenated identifiers. At most 32 integrations, each with 1–32 scopes. |
| `withAccessToken(integrationId, operation)` | Preferred business API: calls `operation(token, signal)` and returns its result. Disconnect, client replacement, new consent, or integration removal aborts the signal and rejects stale results. Keep the entire downstream request inside this callback. |
| `getAccessToken(integrationId)` | Low-level host API: returns a short-lived token only for a currently registered integration whose scopes are granted. Refreshes when necessary. Rejects unknown IDs or missing permissions; never starts consent. There is no unscoped overload. Raw tokens cannot be recalled after issuance; use the operation wrapper for lifecycle-bound work. |
| `status()` | Returns connection/account facts, callback mode/bridge availability, and registered integration scopes, authorization status, and missing scopes. Never returns credentials. |
| `getAccessGeneration()` | Returns a non-secret process-local revision for account access. Reconnect, reset, integration removal, and disposal advance it; ordinary token refresh does not. It is an invalidation marker, not proof of authentication. |
| `onAccessChange(listener)` | Subscribes a trusted Host consumer to access invalidation and returns a disposer. Drive uses this to revoke session selections. Listener failures cannot prevent account invalidation. |
| `setCallbackMode(useSandbox)` | Persists the boolean preference and cancels a pending login. Uses the same local Settings authorization boundary. |
| `begin(integrationId)` | Starts explicit browser consent for one registered integration. The Settings UI is the intended caller. |
| `cancel()`, `disconnect()`, `configure(clientJson)`, `clearConfig()` | Manage the shared connection through the local Settings boundary. |

HTTP accepts an integration ID for consent, never arbitrary scopes. Account controls require same-origin local POST requests with the plugin's custom header. There is no HTTP token endpoint.

Future GCP tools can register the IAM scope and use their token for narrowly permissioned service-account impersonation. IAM roles remain the authority for the service account's capabilities. A future trusted `gws` adapter can register its required scopes and use `withAccessToken` to pass the token only in a child process's environment. It must stop the subprocess when the supplied signal aborts and must not expose tokens through generic shell arguments, tool results, or logs.

## Credential records

The provider uses these DSH credential keys:

- `google-auth/client`: `{ kind: 'grant', payload: { version: 1, clientId, clientSecret? } }`.
- `google-auth/default`: `{ kind: 'grant', payload: { version: 1, clientId, tokens } }`, where tokens contain `accessToken`, `refreshToken`, `expiresAt`, canonical `scopes`, and `account: { id, email? }`.

These are structural field names, not credentials. Old pre-release `google-drive/*` records are not imported or modified automatically. If you tested the earlier Drive-owned auth version, configure and connect again in Google accounts; legacy records can be removed separately after checking that they are no longer needed.

## Verification

The automated suites use synthetic tokens, mock Google responses, real ephemeral loopback callbacks and TCP forwarding relays, mocked bridge clients, real DSH service/route lifecycle fixtures, and browser component tests. They do not authenticate a real account or deploy a live profile. A real consent and Drive listing test remains a post-deployment step.
