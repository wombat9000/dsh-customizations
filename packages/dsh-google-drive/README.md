# Google Drive

`@local/dsh-google-drive` provides session-scoped Drive reading and Google Sheets reading and approved edits. Enable **Google Drive** in the session toolbar to expose `request_drive_access` and `request_sheets_edit_access`, regardless of the session's preset. The toggle defaults off, including in the **Google Drive** preset. Enabling it grants no file access. Both request tools use our private picker. Read grants expose Drive listing, text reading, and Sheets range reading. Separate edit grants expose a local Sheets preview; only **Apply changes** sends the exact reviewed write. See [Sheets setup, preview, and limits](docs/sheets.md).

## Prerequisites and security boundary

- Compose the updated [Google auth provider](../dsh-google-auth/README.md) before Drive. Authentication, credentials, client configuration, and OAuth remain in that provider.
- Enable the Google Drive API in the Cloud project owning the configured Desktop OAuth client.
- Use **Connect Google account** in **Settings → Plugins → Google accounts** to grant all enabled integration scopes in one OAuth flow. This bundle requests `https://www.googleapis.com/auth/drive.readonly` and account-wide `https://www.googleapis.com/auth/spreadsheets`. If an existing connection lacks scopes, choose **Grant additional permissions**. Installing this update does not start OAuth or request consent automatically.
- Google authorizes account-level read access; **DSH**, not Google OAuth, enforces the selected file/folder subset. This version does not use Google Picker's `drive.file` authorization model.
- This protects the Drive service and its model tools against out-of-selection requests. It is not a security boundary against trusted Host plugins, arbitrary same-process code, or shell tools with access to credentials/runtime files. Keep DSH's filesystem and execution policies appropriate for your threat model.

Drive file creation, deletion, sharing, and uploads remain unavailable. Separate Sheets tools read bounded ranges and propose cell values, formulas, clears, and basic formatting with one-shot approval. Sheets needs the Sheets API enabled; the combined account login requests its account-wide `spreadsheets` consent alongside Drive reading. Google does not enforce our selected-file write restriction; DSH does.

The text reader supports Google Docs exported as plain text, plain text, Markdown, CSV, TSV, JSON, and PDF text extraction with optional local optical character recognition (OCR). PDF support requires administrator-installed tools in the **DSH Host's environment**, not merely the agent's sandbox. See [PDF runtime setup and security limits](docs/pdf-runtime.md). Text and Sheets reading need no native tools. Slides, standalone images, and other binary formats remain unsupported; their metadata can still be listed within the selection.

## Install and request access

Installation and profile application require explicit approval. Follow the repository's [setup procedure](../../README.md#apply-the-starter-profile). Keep OAuth configuration, tokens, and runtime state outside Git.

1. Check for an existing preset ID named `google-drive` before applying the bundle. Resolve collisions without editing shipped presets.
2. After approval, update both Google auth and Google Drive. Preserve custom preset roots: Cordis replaces the roster's entire configuration rather than merging individual fields.
3. Restart the existing DSH profile and refresh its Web page.
4. In **Settings → Plugins → Google accounts**, configure the downloaded Desktop OAuth client JSON if needed. For Docker Sandbox, enable **Use sandbox callback forwarding**; otherwise leave it off. Choose **Connect Google account** (or **Grant additional permissions** for an existing connection) and approve the combined required scopes. See [callback prerequisites](../dsh-google-auth/README.md#callback-routing).
5. Open a top-level session with any preset and enable **Google Drive** beside the session's **Recap** control. The toggle exposes the two access-request tools but grants no Drive resource access. The optional **Google Drive** preset remains available; it uses the same default-off toggle.
6. Ask the agent to find or read Drive documents. Its `request_drive_access` card offers **Choose files and folders** and **Deny**.
7. Open the picker, select resources, review the selection, and choose **Allow read access**. Opening or cancelling the modal grants nothing. **Cancel** closes the picker without denying the pending request; **Deny** settles it without access.
8. Confirm that the card reports the grant. The agent loads `google-drive-read` before using the newly exposed tools.

The picker starts at **My Drive**. Click a folder name to browse it; use its checkbox to select recursive access. Search looks across Drive, not only the current folder. **Review selection** expands the selected items for inspection or removal. The selection count and confirmation buttons stay visible while files scroll. See the [design screenshots](docs/screenshots/README.md) for dark, light, and narrow layouts.

The host bundle supplies the toolbar toggle and scoped registrations; other presets need no Google Drive row. Installing the bundle does not enable the toggle, grant file access, change the default preset, or modify shipped Standard files. Legacy presets containing the tools row remain loadable, but that row no longer exposes tools automatically.

Turning **Google Drive** off removes the request tools and all progressively exposed tools and skills. It revokes both read and edit selections and cancels pending access requests and previews. Re-enabling starts without file grants; old tool calls and approval cards cannot restore them. The toggle belongs to the exact live top-level session, is not persisted across unload or Host restart, and does not transfer to subagents. Turning it off does not disconnect the Google account, revoke Google's consent, erase conversation content, or undo writes already sent. A dispatched write can still report an uncertain outcome; check the affected cells before proposing another change.

## Selection and lifetime

- Explicit files remain selected by ID if renamed or moved, provided Google still makes them available and they are not trashed.
- Selected folders include their current descendants and future additions, recursively. A descendant moved outside all selected folders loses access on subsequent checks unless it is also explicitly selected.
- Shortcuts do not grant access to targets and are excluded from the picker and listings.
- At most 100 files/folders can be selected. Ancestry walks are bounded to 100 parents; exceeding that limit fails closed.
- Picker browsing and searches do not enter model output or local transition diagnostics. The model receives only the confirmed resource summary and later authorized tool results.
- **Manage access** opens a fresh request with the current selection. Confirmation replaces the selection; deselected resources lose access. **Revoke all access** removes the entire session grant and cancels pending requests.
- Pending requests expire after ten minutes. Cancelling the requesting tool cancels its request. Approval policy `never` prevents new interactive requests and confirmations.
- Grants belong to the exact live top-level agent/session and Google account lifetime. Other sessions and subagents do not inherit them.
- Grants are intentionally in memory. Session unload, Host restart, plugin disposal, disconnect, client replacement, or a new Google sign-in invalidates access. Resuming a session requires a fresh request; old cards are not authority.
- Revocation cancels in-flight operations and suppresses late results, even when a transport ignores cancellation. It cannot remove content already returned to the conversation.

Google does not offer an atomic transaction combining ancestry checks with content reads. The service checks ancestry before and after reading, but a concurrent remote move immediately after the final check can only be observed on the next operation.

## Tools and skill

| Capability | Availability | Behavior |
| --- | --- | --- |
| `request_drive_access` | While the session toggle is on | Requests selection with a task-specific reason; never accepts a model-supplied grant. |
| `google_drive_list_files` | After a grant | Lists selected roots, or current children of an authorized `folderId`; defaults to ten entries, maximum 100. |
| `google_drive_read_file` | After a grant | Reads supported text or a PDF page range; default text limit 65,536 UTF-8 bytes, maximum 262,144. Oversized text fails rather than silently truncating. |
| `google-drive-read` | After a read grant | On-demand trusted instructions for browsing, reading, citations, and handling untrusted file content. |
| `request_sheets_edit_access` | While the session toggle is on | Requests individual spreadsheets for session editing; selection never applies a write. |
| `google_sheets_list_tabs` | After a read or edit grant | Lists at most 100 grid tabs for an authorized spreadsheet. |
| `google_sheets_read_range` | After a read or edit grant | Reads an explicit tab-qualified rectangle: at most 200 cells, 20 columns, and 100 rows. |
| `google_sheets_propose_edit` | After an edit grant | Prepares a local before/after preview and waits for exact human approval; no model-callable apply operation. |
| `google-sheets` | After a read or edit grant | Trusted instructions for bounded reads, changes, approval, concurrency, and uncertain outcomes. |

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

The Host owns `googleDrive`, permission state, and browser endpoints. Drive and Sheets reads use `googleAuth.withAccessToken('google-drive', operation)`. Sheets proposal preparation and approved writes use the separately declared `google-sheets-edit` integration. Registration declares consent requirements only; it neither reads credentials nor begins OAuth. The auth provider exposes a non-secret access generation and change subscription so both grant types invalidate immediately when account access changes.

The Host owns the session tool lifecycle. While the toolbar toggle is on, it registers tools and skills through the exact live agent's scoped context, not through a global or shared preset registry. All presets use this same path. The legacy row remains a compatibility entry point and does not enable tools:

```yaml
- id: tool-google-drive
  name: '@local/dsh-google-drive/tools'
```

The public read methods require the exact live agent: `listFiles(agent, args)` and `readText(agent, args)`. The old account-wide `listFiles(args)` interface is removed. Tool execution also checks the current enable generation, so retaining a tool object after disabling or re-enabling does not preserve authority. Neither bundle registers tools globally.

The Client uses the keyed `tool.call.toolview` slot and an additive `shell.overlay` slot. A native modal dialog supplies focus isolation. This does not use the native binary approval control: only the validated selection endpoint can establish a resource grant.

Same-origin, loopback JSON POST endpoints under `/api/plugins/google-drive/` require the `X-DSH-Google-Drive: 1` header:

- `session-status` accepts only `{ sessionId }`. It resolves an already live top-level agent without loading or creating a session. Its response reports availability and, for a live session, `enabled`, an opaque `ownerId`, and `revision`.
- `session-set` accepts only `{ sessionId, ownerId, revision, enabled }`. The exact owner incarnation and revision must still match. The browser cannot supply grants, tool definitions, or an Agent object. Concurrent tabs and reused session IDs cannot silently overwrite newer state.
- `status`, `browse`, `grant`, `deny`, `manage`, and `revoke` manage reading. The `edit-` prefixed equivalents manage independent Sheets edit grants. These use exact session/tool-call identity; pending decisions also require an opaque request ID. Mutation paths reject cards from a previous enable lifetime.
- `preview-status`, `preview-apply`, and `preview-deny` operate on Host-retained proposals. The browser never submits an edit payload or Google request. Status remains readable while the toggle is off, without retaining revoked cell data, so an uncertain dispatched write is not hidden.

The Host rejects stale, duplicate, cancelled, cross-session, and invalid selections. There is no token endpoint. Generic approval cannot bypass selection or the exact preview.

Permission transition diagnostics stay in memory on each request record: at most 20 entries containing outcomes and confirmed resource IDs/recursion flags, never picker browsing or file contents. They are not a durable audit trail and never restore grants. Grant publication waits for the local transition to finish; if it fails, access is removed. The newest 20 settled request cards per live session retain management state; older cards require a fresh tool request.

The plugin does not append custom `google-drive/access` events to session history. DSH `0.1.2-rc.1` rejects unknown events without an `ignorable` envelope marker, but its public append API cannot write that marker. Earlier versions wrote incompatible records; this fix prevents new ones and does not repair or delete existing histories. After an approved plugin update and Host restart, use a new session if an older history already fails to load.

## Verification boundary

Tests use synthetic Google responses, real dormant DSH preset/scoped-registry fixtures, actual compressed JSONL session flush/reopen checks, loopback HTTP integration, and Chromium component interactions. No credentials or real Drive contents enter tests. These checks do not imply live profile deployment, real Google consent, or a real Drive read. After an approved deployment, verify selection, reading, cross-session denial, and revocation in the existing GUI.
