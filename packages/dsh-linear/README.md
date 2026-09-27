# @local/dsh-linear

Workspace-scoped Linear integration for DSH `0.1.7-rc.2` with broad read access and approval-gated project writes.

## What it adds

- A workspace connection page under **Plugins**, on the Linear bundle's **Configure** row.
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
2. Open **Plugins** on the loopback Web URL, select the Linear bundle, and choose **Configure** for its Linear row.
3. Paste the API key and choose **Connect**.

The key is sent write-only to DSH's credential provider and is never returned to the browser. DSH persists the resulting workspace identity in the profile's Cordis patch, under the `local-linear` entry.

An existing `LINEAR_API_KEY` from the launch environment is supported but read-only on the configuration page. Use **Test connection** to bind and verify it.

### Retained workspace bindings

Before upgrading a retained profile, back up its configuration and check for an old `settings.yaml` section named `linear`. DSH `0.1.7-rc.2` imports legacy sections by Loader entry ID, but this bundle's entry is `local-linear`. Upstream does not remap `linear` to `local-linear` automatically.

Preserve `organizationId`, `organizationName`, and `organizationUrlKey` under the `local-linear` entry's `config` in the active profile patch before relying on the old workspace restriction. If DSH has already attempted the import, inspect `settings.yaml.imported`: DSH renames the file before importing and leaves rejected sections there without retrying them. Verify the workspace on the Linear configuration page before using its tools. Credentials remain in the credential store; do not copy API keys into the patch.

## Development

The client registers `plugins.row.config` with key `@local/dsh-linear#local-linear`. Summary rendering is static; page rendering mounts the connection form. The RPC channel remains `/linear-integration`.

The three workspace identity fields use `.volatile()` in `Config`; runtime reads use their `.get()` references. Settings projects those fields under the Loader entry ID rather than an `installSection` registration. An optional Settings injection registers `configure({ auto: false }, ctx.fiber)` as an effect because the plugin provides its own page. Tools can read configuration without the Settings service; connecting or clearing a workspace still requires Settings persistence.

After the repository's dependency setup, run these commands from the repository root. Tests use fixture SDK clients, real Schemastery volatile references, and dormant host contexts. The integration suite checks recipe wiring, live reference reads, presentation-policy cleanup, and RPC cleanup; it does not install a profile, start DSH, or verify the live GUI.

```bash
pnpm --filter @local/dsh-linear test
pnpm --filter @local/dsh-linear test:integration
```
