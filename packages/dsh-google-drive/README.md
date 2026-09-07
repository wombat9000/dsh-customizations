# Google Drive

This persistent DSH plugin adds a Google Drive connection card and a **Google Drive** agent preset. The preset retains Standard's coding tools and adds `google_drive_list_files` for read-only file metadata listing. This package is not a temporary dynamic Cordis plugin.

## Scope and prerequisites

- The plugin requests `https://www.googleapis.com/auth/drive.metadata.readonly` and exposes only read-only metadata operations. A shared existing Google OAuth grant can carry broader previously granted scopes; an access token is not guaranteed to be exclusively metadata-scoped. The plugin does not read file contents, modify Drive files, or provide Docs, Sheets, or Forms operations.
- The plugin supports one Google account per DSH credential store. Sessions and profiles sharing that store share the account. Use one active DSH host to manage this connection; cross-process token refresh coordination is not implemented.
- The OAuth callback listens on host loopback address `127.0.0.1`. Your browser must run on the same host as DSH; a remote browser or container loopback does not reach that listener automatically.
- The package does not install or execute the `gws` CLI.
- Keep OAuth client configuration, tokens, and DSH runtime state outside this repository.

## Configure the OAuth client

Create a Google OAuth **Desktop app** client in a Google Cloud project with the Drive API enabled. Download its client JSON. This is OAuth client configuration, not a user credential or an authorized-user token file.

In **Settings → Plugins → Google Drive**, paste the downloaded Desktop JSON into the write-only configuration textarea, then choose **Save client configuration**. The plugin validates `installed.client_id` and the optional `installed.client_secret`, and stores only those normalized fields. It uses fixed Google endpoints rather than endpoints supplied in the JSON. The UI never returns the saved JSON or client secret.

Replacing or removing the configuration cancels any pending connection flow and clears the old connection. Clearing configuration deletes both the local client configuration and token record. Version 1 has no `clientJsonPath` or separate host-file configuration support. Do not put the JSON in a composition, model prompt, or Git.

## Install and select the preset

Installation and profile application require explicit approval. Follow the repository's [setup and apply procedure](../../README.md#apply-the-starter-profile); these instructions do not authorize either operation.

1. Before applying the profile, check for an existing preset ID named `google-drive`. Resolve any collision without modifying shipped presets.
2. After approval, install/apply the bundle and its preset roster configuration. If your profile has custom preset roots, preserve those roots: a patch replaces the roster's complete `config`, rather than merging individual fields.
3. Restart the DSH profile, then refresh its existing Web page.
4. Open **Settings → Plugins → Google Drive**, save the OAuth client configuration, and connect as described below.
5. Select **Google Drive** when creating a new session. Confirm that the session exposes `google_drive_list_files`.

The bundled preset is a copy of Standard from pinned `@deepseek-ai/dsh-agent-presets` `0.1.2-rc.1`, with the Drive consumer appended. It preserves Standard's configuration and plan-mode guidance. Installation does not change shipped Standard files or add tools to existing sessions.

## Connect or disconnect

In **Settings → Plugins → Google Drive**, choose **Connect**, then complete Google's consent flow in your browser. The settings card reports connection status, not tokens. Treat connection status and listed metadata as sensitive account information.

If you no longer want to complete an in-progress connection, use the card's cancel action. Once the credential store starts committing the grant, cancellation reports that sign-in is finishing; wait for completion, then disconnect if needed. To remove the saved local connection, use its disconnect action. Disconnect is **local only**: it removes the stored token record but keeps the client configuration. It does not revoke Google's grant. Optionally, revoke access manually in your Google account's third-party access settings.

The settings control endpoints accept local, same-origin requests only. They are not a remote token API.

## Host and agent boundaries

The host provider injects `credentials`, `webServer`, and `settings`. It registers an empty settings namespace so DSH dispatches the card; neither the client JSON nor tokens enter the settings document. It owns OAuth, credential persistence, settings endpoints, and the shared `googleDrive` service:

- `listFiles` lists Drive metadata for the connected account.
- `getAccessToken` obtains an access token for trusted host-side consumers. It is host-only and is not exposed as a model tool or an HTTP endpoint.

The agent preset appends this consumer row outside an isolate realm so it can resolve the host service:

```yaml
- id: tool-google-drive
  name: '@local/dsh-google-drive/tools'
```

That row contributes the per-agent `google_drive_list_files` tool. It does not create another account service.

### Credential storage

The plugin stores normalized client configuration under DSH credential provider `google-drive`, key `client`. Its structural shape is `{ kind: 'grant', payload: { version: 1, clientId, clientSecret? } }`, where `clientSecret?` denotes an optional field.

The account token record uses the same provider, key `default`, with this structural shape:

```text
{ kind: 'grant', payload: { version: 1, clientId, tokens } }
```

These shapes describe field names, not sample credentials. The underlying DSH credential provider controls storage at rest; this package does not guarantee encryption. Tokens remain host-side and must not appear in status responses, tool results, logs, or documentation.

### Future CLI integration

A future trusted host-side `gws` integration can call `googleDrive.getAccessToken` and pass the result only in the child process's environment. It must never expose that token through a model tool or HTTP response. No such CLI installation or execution is included yet.

## Verification boundary

The installation and connection steps above are checks to perform after an approved deployment. This documentation does not claim a live profile mount, browser connection, OAuth exchange, or Google Drive request has been verified.
