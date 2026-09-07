# Google Drive

`@local/dsh-google-drive` adds read-only Drive metadata listing and a **Google Drive** agent preset. Authentication belongs to the separate [Google auth provider](../dsh-google-auth/README.md); this package has no login implementation, credential store, client configuration, or browser Settings card.

## Scope and prerequisites

- Compose `@local/dsh-google-auth` on the host before Drive. The personal-web recipe includes both. Without `googleAuth`, the Drive host waits instead of creating another auth provider.
- Enable the Google Drive API in the OAuth client's Google Cloud project.
- Drive declares `https://www.googleapis.com/auth/drive.metadata.readonly`. Registration alone performs no OAuth or Google API request. Missing permissions require explicit consent in **Settings → Plugins → Google accounts**.
- The only tool is `google_drive_list_files`. It lists non-trashed file metadata, defaults to ten files, supports bounded pagination/search, and never reads contents or modifies files.
- Docs, Sheets, Forms, Gmail, GCP, and `gws` execution are not included. Authentication is ready for separate future integrations.

## Install, connect, and select the preset

Installation and profile application require explicit approval. Follow the repository's [setup procedure](../../README.md#apply-the-starter-profile). Keep OAuth configuration, tokens, and DSH runtime state outside Git.

1. Before applying the profile, check for an existing preset ID named `google-drive`. Resolve collisions without modifying shipped presets.
2. After approval, install/apply Google auth and Google Drive. If your profile has custom preset roots, preserve those roots: Cordis replaces the roster's complete configuration rather than merging individual fields.
3. Restart the existing DSH profile and refresh its Web page.
4. Open **Settings → Plugins → Google accounts** and save the downloaded Desktop OAuth JSON in the write-only field. If DSH runs in Docker Sandbox, enable **Use sandbox callback forwarding**; otherwise leave it off. Choose **Connect Google Drive**, then follow **Continue with Google**. See [callback routing prerequisites](../dsh-google-auth/README.md#callback-routing).
5. Select **Google Drive** when creating a new session and confirm that it exposes `google_drive_list_files`.
6. Ask the agent to list ten Drive files. The result contains names, IDs, types, safe Google links when available, and a next-page token when another page exists.

The preset copies Standard from pinned `@deepseek-ai/dsh-agent-presets` `0.1.2-rc.1` and appends only the Drive tool consumer. It preserves Standard configuration, plan-mode guidance, and upstream attribution. Installing it does not add tools to existing sessions or alter shipped Standard files.

## Shared account behavior

Google accounts Settings shows the registered Drive integration and its missing permissions. Future integrations can request additional consent using the same Desktop client and connected account. Drive does not depend on Gmail or GCP and cannot silently request their permissions.

One account is shared per credential store in this version. Disconnecting or replacing the shared client clears local access for all integrations and aborts in-flight Drive operations. The operation wrapper also rejects late previous-account results, even if a transport ignores cancellation. Switching Google accounts requires disconnecting first. Disconnect is local and does not revoke Google's grant.

The shared provider owns callback, storage, scope normalization, account binding, refresh, and lifecycle rules. See its [security and account limitations](../dsh-google-auth/README.md#remove-access), including the single-active-host limitation and the fact that a reused OAuth grant can contain broader preexisting scopes.

## Composition boundaries

The Drive host injects `googleAuth`, registers the `google-drive` integration with its exact metadata scope, and publishes a `googleDrive` service containing only `listFiles(args)`. Every complete API operation runs through `googleAuth.withAccessToken('google-drive', operation)`. The shared auth signal cancels downstream access when the account lifecycle changes. Drive never exposes tokens.

The agent preset contributes the model tool outside an isolate realm so it can resolve that host service:

```yaml
- id: tool-google-drive
  name: '@local/dsh-google-drive/tools'
```

The tool consumer registers no service. Neither host bundle registers model tools globally.

## Verification boundary

Tests use synthetic credentials and mock Google responses, real DSH service/preset fixtures, and browser component tests. No live profile deployment, real Google login, or real Drive request is implied. Perform the connection and listing steps after an approved deployment. The earlier pre-release Drive-owned auth configuration is not imported automatically; configure the shared Google accounts provider and reconnect if you tested that version.
