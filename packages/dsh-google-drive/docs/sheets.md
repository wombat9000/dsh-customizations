# Read and edit Google Sheets with a local preview

The Google Drive preset can read selected spreadsheets and propose bounded cell edits. Our existing picker controls session access. A local before/after preview shows the proposed values, formulas, clears, and basic formatting. Only **Apply changes** sends the exact reviewed batch to Google; creating or cancelling a preview sends no write.

## Permissions and setup

**Google grants account-wide Sheets write capability. DSH—not Google—restricts editing to selected spreadsheets and approved changes.** This uses the `spreadsheets` scope, not Google Picker or `drive.file`. Trusted Host code or shell access to credentials can bypass the DSH tool boundary. Use appropriate filesystem and execution policies.

After an explicitly approved plugin update, Host restart, and Web refresh:

1. Enable both the Google Drive API and Google Sheets API in the Cloud project that owns your Desktop OAuth client.
2. In **Settings → Plugins → Google accounts**, connect **Google Drive** with `https://www.googleapis.com/auth/drive.readonly`. That scope also authorizes Sheets reads; no additional read consent is needed.
3. If you want editing, connect **Google Sheets editing (account-wide)** and consent to `https://www.googleapis.com/auth/spreadsheets`. This is separate, explicit consent. Existing Google file permissions still apply: the API cannot edit a spreadsheet your account cannot edit.
4. Start a new **Google Drive** session. Request read access through `request_drive_access`, or editing through `request_sheets_edit_access`.
5. For editing, use our picker to select individual spreadsheets and allow editing for this session. Folders remain navigable but cannot be selected for recursive editing.

Installing or merging this version does not enable APIs, start OAuth, change Google accounts, apply a profile, or deploy to a running GUI. Sheets adds no npm or native dependencies.

### Three separate permissions

| Layer | What it authorizes | Lifetime |
| --- | --- | --- |
| Google consent | Underlying account-wide read or Sheets write capability | Until Google authorization is revoked or expires; DSH session removal does not remove it. |
| DSH session selection | Reading selected files/folders, or reading and proposing edits to individually selected spreadsheets | Exact live top-level session and account generation; no subagent inheritance. |
| Apply changes | One immutable reviewed batch | One attempt only; denial, expiry, cancellation, failure, or completion makes it unusable. |

Read grants never become edit grants. An edit grant permits Sheets reads for its selected spreadsheets but does not expose unrelated Drive files. Read and edit selections are independent: removing a read grant does not remove an existing edit grant, and removing editing does not remove an independent read grant. Manage each card separately. Removing both ends this session's access, not Google's account consent or changes already written.

Session unload, Host restart, plugin disposal, account disconnect, client replacement, and a new Google sign-in invalidate grants. Consent changes can therefore require selecting resources again. Revocation cancels pending previews and in-flight operations. It cannot erase already-returned conversation content or undo a write already dispatched.

## Read a spreadsheet

1. Call `google_sheets_list_tabs` with an authorized `fileId` to discover tab names and dimensions. The result includes at most 100 grid tabs and a `truncated` flag.
2. Call `google_sheets_read_range` with an explicit tab-qualified rectangle, such as `Budget!A1:F20` or `'Annual Budget'!A1:F20`.
3. Inspect explicit cell addresses, entered values/formulas, current effective values, displayed text, and supported basic formatting. Missing cells are normalized to explicit empty cells. A range is not the whole spreadsheet.

Each rectangle has at most **200 cells, 20 columns, and 100 rows**. Whole-column ranges, whole-tab ranges, named ranges, and arbitrary queries are unavailable. Drive read grants retain their normal ancestry checks before and after the operation; explicit edit grants apply only to the selected spreadsheet ID.

## Preview and approve a change

Call `google_sheets_propose_edit` with `fileId`, `range`, and unique addressed `changes`. For example, using a previously authorized spreadsheet ID:

```json
{
  "fileId": "approved-spreadsheet-id",
  "range": "Budget!A1:C3",
  "changes": [
    { "cell": "A1", "value": "Monthly budget", "format": { "textFormat": { "bold": true } } },
    { "cell": "B2", "value": 1250, "format": { "numberFormat": { "type": "CURRENCY", "pattern": "€#,##0.00" } } },
    { "cell": "C2", "formula": "=B2*12" },
    { "cell": "A3", "value": null }
  ]
}
```

- Omitted fields remain unchanged. `value: null` explicitly clears content.
- `value` accepts a literal string, finite number, or boolean. A string beginning with `=` remains a literal string, not a formula.
- `formula` explicitly creates a formula and must start with `=`. It cannot be combined with `value` on the same change.
- `format` supports fonts, text/background colors, borders, alignment, wrapping, and number formats. Formatting-only changes preserve values and formulas.
- Null clears supported formatting. Number formats require a `type` for a non-null update; clear the whole number format with `numberFormat: null`. Color objects and number formats use replacement semantics rather than merging ambiguous partial structures.
- Unsupported fields, duplicate cell changes, empty changes, and out-of-range cells fail closed. Unchanged values and formatting are omitted from the write; an entirely unchanged proposal is rejected. In particular, DSH does not silently resend an unchanged formula. This is not an arbitrary Google `batchUpdate` interface.

The tool waits while you review. The browser sends only the session, call, and opaque request identity when you approve or deny; it cannot replace the Host-retained proposal. Review all changed cells and the exact field differences before choosing **Apply changes**. Selecting a spreadsheet alone never permits automatic writes.

### Preview limitations

The preview is an approximation of supported cell formatting, not Google Sheets embedded in DSH. It does not reproduce conditional formatting, theme resolution, rich text, smart chips, charts, or the full spreadsheet layout. The exact value/formula/format differences are authoritative for the proposed write.

The preview does not evaluate formulas or predict formatted number/date output. It shows raw values and formula text; changed displays are marked uncalculated. Spreadsheet locale and Google calculation determine the eventual display. Formula changes can recalculate cells outside the preview and can invoke external-data functions. Approval bounds the submitted cell mutations, not all downstream formula effects.

To avoid hidden destructive effects, this version rejects content changes in cells containing rich-text runs or smart chips and in calculated-output cells. Google can erase runs when replacing an entered value even with a narrow field mask. Merged-cell edits are also rejected. These cells can still appear in bounded reads; full run contents are not returned.

## Write safeguards and outcomes

Before dispatch, DSH rechecks the live owner, account generation, edit-grant revision, expiry, and approval policy. It re-reads the rectangle and rejects changed entered values, supported basic formatting, unsupported-content presence markers, or tab identity/dimensions. Effective-value recalculation alone does not make a preview stale.

**Sheets has no revision precondition on this write endpoint.** A collaborator can still edit between the final read and dispatch, or before readback. One atomic batch ensures that the submitted updates apply together; it does not make them conflict-free. Avoid concurrent editing when reviewing important changes.

The write is attempted once. DSH reads back the range after a successful response and returns the observed snapshot. That observation is not an automatic rollback guarantee or proof that collaborators made no changes.

- **Denied/cancelled before dispatch:** no write was dispatched.
- **Failed before dispatch:** prepare a new preview after resolving access, stale content, or validation issues.
- **Applied:** Google accepted the batch and DSH obtained a readback.
- **Uncertain:** a write might have occurred, or Google accepted it but readback failed. Read the affected cells and compare them with the intended change. Do not blindly retry the old operation; a new write needs a new preview and approval.

Cancellation, revocation, browser disconnection, or timeout after dispatch can produce an uncertain outcome. They do not imply rollback. No automatic write retry occurs, even after an ambiguous network failure. HTTP write failures are conservatively treated as uncertain once dispatched.

## Bounds and storage

- At most 100 individually selected spreadsheets per edit grant.
- At most 200 changed cells within one bounded rectangle per preview.
- At most 20 preview records per live session; active records count toward the limit.
- Preview lifetime: ten minutes from preparation start, including time spent awaiting approval.
- Strings: at most 10,000 characters per cell value/formula. Font names and format patterns have smaller limits.
- Google responses: bounded to 2,000,000 bytes; error bodies to 16,384 bytes. Oversized responses fail instead of silently truncating cells.
- Proposal JSON: bounded to 1,500,000 characters, including before/after data and exact requests.
- All requests have deadlines and lifecycle-owned cancellation. No credentials or tokens enter the browser or model output.

Grants and previews remain in Host memory and do not survive restart. Ordinary tool results persist through DSH's standard history mechanisms. This plugin appends no custom session event types and adds no durable audit or grant-restoration mechanism.

## Out of scope

No file creation/copy/deletion/sharing; tab creation/deletion; row or column insertion/deletion; append, sort, resizing, freezing, merging, filters, protected-range management, conditional-format edits, charts, pivots, or advanced tables. There is no native suggestion mode, local formula engine, standing write approval, undo service, or conflict-free collaboration guarantee.

## Verification boundary

Tests use synthetic Google responses, real permission and scoped-registry fixtures, loopback routes, and browser components. The browser suite includes a fixture generated by the real proposal compiler; a Node test detects fixture drift. [Preview and picker screenshots](screenshots/README.md#sheets-editing-and-local-preview) use synthetic spreadsheet data with the pinned DSH theme. They do not establish live Google OAuth consent, a real Sheets write, or deployment to the existing GUI. After an approved deployment, verify the complete flow on a disposable spreadsheet before using important data.

## Google API references

- [Read spreadsheet values and accepted scopes](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get)
- [Spreadsheet grid reads](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get)
- [Atomic batch updates and collaboration caveat](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate)
- [Cell data, number formats, and rich-text side effects](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/cells)
- [Choose Sheets OAuth scopes](https://developers.google.com/workspace/sheets/api/scopes)
