# Google Drive

`@local/dsh-google-drive` provides progressive, session-scoped read access to selected Google Drive files and folders. The **Google Drive** preset retains Standard coding tools but initially exposes only `request_drive_access`. Its custom conversation card opens a private file/folder picker. After you confirm the selection, the session receives listing and text-reading tools plus the `google-drive-read` skill.

## Prerequisites and security boundary

- Compose the updated [Google auth provider](../dsh-google-auth/README.md) before Drive. Authentication, credentials, client configuration, and OAuth remain in that provider.
- Enable the Google Drive API in the Cloud project owning the configured Desktop OAuth client.
- Grant `https://www.googleapis.com/auth/drive.readonly` through **Settings → Plugins → Google accounts**. Existing metadata-only connections need explicit additional consent. Installing this update does not start OAuth or request that consent automatically.
- Google authorizes account-level read access; **DSH**, not Google OAuth, enforces the selected file/folder subset. This version does not use Google Picker's `drive.file` authorization model.
- This protects the Drive service and its model tools against out-of-selection requests. It is not a security boundary against trusted Host plugins, arbitrary same-process code, or shell tools with access to credentials/runtime files. Keep DSH's filesystem and execution policies appropriate for your threat model.

There are no Drive write, delete, share, or upload operations. Supported content includes Google Docs exported as plain text, plain text, Markdown, CSV, TSV, JSON, and PDF text extraction with optional local optical character recognition (OCR). PDF support requires administrator-installed tools in the **DSH Host's environment**, not merely the agent's sandbox. See [PDF runtime setup and security limits](docs/pdf-runtime.md). Text reading does not require those tools. Sheets, Slides, standalone images, and other binary formats remain unsupported; their metadata can still be listed within the selection.

## Install and request access

Installation and profile application require explicit approval. Follow the repository's [setup procedure](../../README.md#apply-the-starter-profile). Keep OAuth configuration, tokens, and runtime state outside Git.

1. Check for an existing preset ID named `google-drive` before applying the bundle. Resolve collisions without editing shipped presets.
2. After approval, update both Google auth and Google Drive. Preserve custom preset roots: Cordis replaces the roster's entire configuration rather than merging individual fields.
3. Restart the existing DSH profile and refresh its Web page.
4. In **Settings → Plugins → Google accounts**, configure the downloaded Desktop OAuth client JSON if needed. For Docker Sandbox, enable **Use sandbox callback forwarding**; otherwise leave it off. Connect Google Drive and approve the missing read scope. See [callback prerequisites](../dsh-google-auth/README.md#callback-routing).
5. Start a new session with the **Google Drive** preset. This is a general-purpose Standard-based preset; selecting it grants no Drive resource access.
6. Ask the agent to find or read Drive documents. Its `request_drive_access` card offers **Choose files and folders** and **Deny**.
7. Open the picker, select resources, review the selection, and choose **Allow read access**. Opening or cancelling the modal grants nothing. **Cancel** closes the picker without denying the pending request; **Deny** settles it without access.
8. Confirm that the card reports the grant. The agent loads `google-drive-read` before using the newly exposed tools.

The picker starts at **My Drive**. Click a folder name to browse it; use its checkbox to select recursive access. Search looks across Drive, not only the current folder. **Review selection** expands the selected items for inspection or removal. The selection count and confirmation buttons stay visible while files scroll. See the [design screenshots](docs/screenshots/README.md) for dark, light, and narrow layouts.

Installing the bundle does not change existing sessions, the default preset, or shipped Standard files. Other authored presets can opt in by adding the consumer row shown below. The stock Standard preset remains unchanged.

## Selection and lifetime

- Explicit files remain selected by ID if renamed or moved, provided Google still makes them available and they are not trashed.
- Selected folders include their current descendants and future additions, recursively. A descendant moved outside all selected folders loses access on subsequent checks unless it is also explicitly selected.
- Shortcuts do not grant access to targets and are excluded from the picker and listings.
- At most 100 files/folders can be selected. Ancestry walks are bounded to 100 parents; exceeding that limit fails closed.
- Picker browsing and searches do not enter model output or the permission audit. The model receives only the confirmed resource summary and later authorized tool results.
- **Manage access** opens a fresh request with the current selection. Confirmation replaces the selection; deselected resources lose access. **Revoke all access** removes the entire session grant and cancels pending requests.
- Pending requests expire after ten minutes. Cancelling the requesting tool cancels its request. Approval policy `never` prevents new interactive requests and confirmations.
- Grants belong to the exact live top-level agent/session and Google account lifetime. Other sessions and subagents do not inherit them.
- Grants are intentionally in memory. Session unload, Host restart, plugin disposal, disconnect, client replacement, or a new Google sign-in invalidates access. Resuming a session requires a fresh request; old cards are not authority.
- Revocation cancels in-flight operations and suppresses late results, even when a transport ignores cancellation. It cannot remove content already returned to the conversation.

Google does not offer an atomic transaction combining ancestry checks with content reads. The service checks ancestry before and after reading, but a concurrent remote move immediately after the final check can only be observed on the next operation.

## Tools and skill

| Capability | Availability | Behavior |
| --- | --- | --- |
| `request_drive_access` | Initially available | Requests selection with a task-specific reason; never accepts a model-supplied grant. |
| `google_drive_list_files` | After a grant | Lists selected roots, or current children of an authorized `folderId`; defaults to ten entries, maximum 100. |
| `google_drive_read_file` | After a grant | Reads supported text or a PDF page range; default text limit 65,536 UTF-8 bytes, maximum 262,144. Oversized text fails rather than silently truncating. |
| `google-drive-read` | After a grant | On-demand trusted instructions for browsing, reading, citations, and handling untrusted file content. |

Listing cursors are opaque and bound to the session, folder, page size, and grant revision. The agent has no account-wide query operation. The private picker supports literal name search. Revocation removes tool/skill registrations; service checks remain authoritative even if a model retains an old schema or loaded skill text.

### Read PDFs and scans

The existing `google_drive_read_file` tool accepts these PDF-only options:

| Option | Behavior |
| --- | --- |
| `startPage`, `endPage` | One-based inclusive page range, at most five pages per call. Defaults to pages 1–5, or the remaining pages of a shorter document. |
| `ocr` | `auto` (default) extracts embedded text and applies OCR to sparse pages; `off` extracts only embedded text; `force` applies OCR to every requested page. |
| `languages` | One to three installed OCR language codes, default `["eng"]`. Supported codes: `eng`, `deu`, `fra`, `spa`, `ita`, `por`. No models are downloaded automatically. |

For example, read the first three pages of an approved German PDF with `{"fileId":"approved-file-id","startPage":1,"endPage":3,"languages":["deu","eng"]}`. Do not supply page or OCR options for non-PDF files.

PDF results include page-numbered `text`, per-page `pages` with `method` (`embedded`, `ocr`, or `none`), `totalPages`, `actualRange`, `warnings`, and `nextStartPage` when later pages remain. Only the returned range has been read. The source MIME type remains in `file.mimeType`; the extracted output's `mimeType` is `text/plain`.

OCR can miss or misread text, tables, handwriting, and layout. Automatic selection is a heuristic: a page with enough embedded text can also contain unread scanned regions. Use `force` when needed, and check important identifiers, amounts, and deadlines against the original. Empty text is not proof that a page contains no information. Encrypted PDFs are rejected, including those that open without a password.

Downloads are limited to 20 MiB and documents to 200 pages. Processing uses bounded native child processes, not the harness event loop. Permission revocation cancels processing and suppresses results; the service rechecks ancestry after processing before returning any content. No PDF or OCR text is cached between reads. Native processes are **not a security sandbox**; review the [platform-specific limits and parser risks](docs/pdf-runtime.md) before enabling them.

## Composition and interfaces

The Host owns `googleDrive`, permission state, and browser endpoints. Every Google operation uses `googleAuth.withAccessToken('google-drive', operation)`. The auth provider exposes a non-secret access generation and change subscription so Drive can invalidate local grants immediately when account access changes.

The authored preset contributes tools and skills, not another service:

```yaml
- id: tool-google-drive
  name: '@local/dsh-google-drive/tools'
```

The public read methods require the exact live agent: `listFiles(agent, args)` and `readText(agent, args)`. The old account-wide `listFiles(args)` interface is removed. The consumer registers read tools and the skill through the granted agent's scoped context. Neither bundle registers tools globally.

The Client uses the keyed `tool.call.toolview` slot and an additive `shell.overlay` slot. A native modal dialog supplies focus isolation. This does not use the native binary approval control: only the validated selection endpoint can establish a resource grant.

Same-origin, loopback JSON POST endpoints under `/api/plugins/google-drive/` provide `status`, `browse`, `grant`, `deny`, `manage`, and `revoke`. They require the `X-DSH-Google-Drive: 1` header, exact session/tool-call identity, and—for browsing and confirmation—a pending opaque request ID. The Host rejects stale, duplicate, cancelled, cross-session, and invalid selections. There is no token endpoint. Generic approval cannot bypass selection.

Session events named `google-drive/access` record request outcomes and confirmed resource IDs/recursion flags, not picker browsing or file contents. They are audit records, not persisted grants or restart recovery. Grant publication waits for the audit append; if it fails, access is removed. The newest 20 settled request cards per live session retain management state; older cards require a fresh tool request.

## Verification boundary

Tests use synthetic Google responses, real dormant DSH preset/scoped-registry fixtures, actual loopback HTTP integration, and Chromium component interactions. No credentials or real Drive contents enter tests. These checks do not imply live profile deployment, real Google consent, or a real Drive read. After an approved deployment, verify selection, reading, cross-session denial, and revocation in the existing GUI.
