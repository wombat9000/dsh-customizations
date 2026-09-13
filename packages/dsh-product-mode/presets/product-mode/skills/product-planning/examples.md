# Issue-writing examples

These fictional drafts illustrate the fallback in [Product planning](SKILL.md#write-concise-issues). They are not inspected implementation plans, approved payloads, or reports of executed tests. Paths and contracts belong to the hypothetical repositories. Resolve the real scope and review the exact body before publication.

## Routine issue

This issue has one outcome: an authorized completed-record CSV export. Its body falls within the suggested 150–300 words. Criteria specify behavior once; the constraints section contains only task-specific boundaries.

Title: Export completed records as CSV

```markdown
## Why
Support staff currently copy completed records into spreadsheets by hand. A downloadable export reduces transcription errors during monthly reconciliation.

## Change
Add CSV output to the existing records export endpoint using the current data-access layer. The export covers the caller's selected workspace and uses the existing download response convention. Keep the scope to backend export behavior; user documentation is a separate task.

## Acceptance criteria
- A fixture containing completed and incomplete records exports only completed records from the selected workspace, in ascending record-ID order.
- The header is exactly `id,title,completed_at`; each row uses that field order and the stored UTC completion timestamp.
- Round-trip parsing preserves titles containing commas, double quotes, and newlines. An empty result contains the header only.
- Permission fixtures verify that callers without workspace read access receive the existing forbidden response and no CSV content.
- Existing data-access tests include the new cases and report their results; no live customer data is needed for validation.

## Constraints
Keep the existing authorization check in the export request path. Do not add fields containing personal contact information or change the UI. Follow the repository's existing CSV serialization convention rather than introducing another dependency.
```

## Short issue without optional sections

A wording correction needs fewer than 150 words because its scope and verification are complete. Do not pad it with constraints, non-goals, or a “Blockers: None” section.

Title: Correct the CSV download label

```markdown
## Why
The completed-record download button says “Download JSON,” although it returns CSV.

## Change
Change that button's visible label to “Download CSV.”

## Acceptance criteria
- The completed-record page renders “Download CSV” as the button's visible and accessible name.
- The existing rendering test asserts that name.
```

## Longer issue for security and recovery detail

This body exceeds 300 words because a credential-format migration needs explicit compatibility, interruption, and recovery behavior for one outcome: safely converting a legacy credential store. These details are not a reason to split the safety contract across loosely related issues. In a real repository, link an existing migration contract instead of copying it, but keep any task-specific exceptions explicit.

Title: Migrate legacy credential records without exposing secrets

```markdown
## Why
The legacy credential store cannot represent expiry metadata required by the new reader. Existing installations need a recoverable conversion before that reader can become the default.

## Change
Add an explicitly invoked offline migration from format version 1 to version 2. Convert each legacy record into the agreed version-2 structure, preserving its identifier and encrypted payload while setting unknown expiry to null. This issue covers the converter and its recovery tests, not activation of the new reader. The operator stops the service before invoking the converter; the converter verifies exclusive access before reading records.

## Acceptance criteria
- A fixture with several legacy records converts to version 2 with the same identifiers and byte-identical encrypted payloads. The version-2 reader opens the result and returns null for previously absent expiry metadata.
- An empty version-1 store produces a valid empty version-2 store. A store already at version 2 returns an unchanged result without creating a new backup or rewriting any record.
- Unknown versions, malformed records, duplicate identifiers, and unavailable exclusive access fail before replacing the original. Each case reports a nonzero exit status and an actionable error that identifies the failure category without including record contents.
- The converter writes a complete candidate store beside the original, validates it with the new reader, then replaces the original atomically. Fault-injection tests cover interrupted writing, validation failure, and replacement failure; each leaves the original readable and unchanged.
- A successful conversion retains a version-1 backup with the original access restrictions. A test restores that backup while the service is stopped and verifies that the old reader opens it with all original records intact.
- Tests capture standard output, standard error, and diagnostic files. None contains plaintext credentials, encrypted payloads, or account identifiers. The report includes aggregate record counts and format versions only.

## Constraints
Use synthetic credentials in fixtures. Do not connect to an account, read the operator's real store, decrypt payloads, or start the service during validation. Keep migration and rollback operator-invoked; neither runs automatically on startup. Retain the backup until the operator explicitly removes it after checking the new reader. Production execution and enabling the new reader require separate approval.
```

## Repository-template precedence

If an applicable repository template requires **Problem**, **Proposed solution**, and **Verification**, use those headings rather than adding the fallback headings as well. Put the reason under **Problem**, scope under **Proposed solution**, and testable outcomes under **Verification**. Preserve required repository fields. Omit optional fields that add no information, and link shared contributor or security guidance instead of pasting it into every issue. The word range remains a suggestion; repository requirements and correctness take precedence.

## Review and publication

Resolve a choice such as “export all records or only completed records” before publishing; an acceptance criterion must not defer that scope decision to the implementer. Keep refinements in the conversation. The examples do not change the skill's planning, review, or exact-call approval boundaries: conversational agreement is not approval for a GitHub write, and publication does not authorize implementation.
