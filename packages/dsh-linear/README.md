# @local/dsh-linear

Workspace-scoped Linear integration for DSH with broad read access and approval-gated project writes.

## What it adds

- A collapsible **Linear** card in **DSH Settings → Plugins → Plugin configuration**.
- Write-only storage of `LINEAR_API_KEY` through DSH credentials.
- Live key validation and a persisted organization-ID binding.
- Nine read tools:
  - `linear_workspace`
  - `linear_search_issues`
  - `linear_list_issues`
  - `linear_get_issue`
  - `linear_get_issue_comments`
  - `linear_list_projects`
  - `linear_get_project`
  - `linear_list_cycles`
  - `linear_list_users`
- Three project write tools:
  - `linear_create_project`
  - `linear_update_project`
  - `linear_create_project_update`

The plugin does not create or modify issues, comments, users, teams, cycles, or workspace configuration.

## Read behavior

`linear_search_issues` provides full-text discovery. `linear_list_issues` provides deterministic filters for team, state, assignee, priority, project, cycle, labels, and creation/update dates. Listing tools use bounded cursor pagination with a maximum page size of 50.

Project selectors accept UUIDs, API slug IDs, exact names, full `linear.app` project URLs (including `/overview`), and browser-visible project path slugs. Project listings render a reusable UUID selector, and pasted URLs are rejected if their workspace path does not match the connected workspace.

Issue relations and comment authors are joined from batched ID catalogs rather than fetching each lazy SDK relation individually. Detailed issue, project, and comment content is bounded before it enters model context. Rate-limit errors report safe retry and reset information without exposing GraphQL queries, variables, or credentials.

All Linear content is treated as untrusted external data in the agent prompt.

## Project write behavior

Every project mutation returns `ask` from DSH's `tools/pre-execute` policy. DSH's approval seam grants only `allowed-once`; rejection, cancellation, an unavailable answerer, or an approval policy of `never` fails closed before the mutation body runs.

Before approval, the plugin resolves human selectors into immutable IDs and prepares a human-readable preview. Execution consumes that exact prepared action once rather than rebuilding it from mutable arguments.

Additional safeguards:

- Project creation warns about exact-name duplicates and rechecks after approval.
- Project updates show a before/after diff.
- Rename updates detect possible duplicates.
- Team removals and completed/canceled transitions receive warnings.
- Updates and project status reports compare `updatedAt` after approval and reject stale writes.
- Full project content and status-report bodies are bounded.
- Delete, archive, trash, and bulk mutation operations are not exposed.

## Install and configure

The `personal-web` recipe selects this bundle after DSH base and Web. Follow the repository's [approved setup and apply procedure](../../README.md#apply-the-starter-profile), then restart the profile and refresh the browser. This package does not modify shipped agent presets.

1. Create a personal API key in Linear for the intended workspace.
2. Open **DSH Settings → Plugins → Plugin configuration** on the loopback Web URL and expand **Linear**.
3. Paste the API key and choose **Connect**.

The key is sent write-only to DSH's credential provider and is never returned to the browser. DSH stores only the resulting workspace identity in settings.

An existing `LINEAR_API_KEY` from the launch environment is supported but read-only in the Settings page. Use **Test connection** to bind and verify it.

## Development

After the repository's dependency setup, run these commands from the repository root. Tests use fixture SDK clients and dormant host contexts. The integration suite checks recipe wiring, settings registration, and RPC cleanup; it does not install a profile, start DSH, or verify the live GUI.

```bash
pnpm --filter @local/dsh-linear test
pnpm --filter @local/dsh-linear test:integration
```
