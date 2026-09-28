# Projects

Projects adds a shared, read-only view of GitHub and Linear work to DSH `0.1.7-rc.2`. Open **Projects** in the left navigation, choose a local project, and select one of its linked sources. Agent tools read the same host service.

A local project can link to GitHub repositories, GitHub Projects, Linear projects, or Linear teams. Links are explicit. Projects does not infer relationships, mirror issues, or write to either tracker. GitHub board fields remain separate from issue state; Linear workflow names retain their native values.

## Setup and boundaries

The personal-web recipe selects this bundle after the existing GitHub and Linear bundles. Source checkout changes do not install it or update a running profile. Apply and restart require separate approval under the [repository setup procedure](../../.agents/skills/repository-setup/SKILL.md).

Projects reuses the GitHub integration's managed `gh` authentication and the Linear integration's configured workspace and credential. It adds no credential fields or login flow. A provider marked loaded is not necessarily authenticated or authorized for a source. An absent integration affects only sources that need it.

**Configure projects** edits local DSH settings, not remote tracker data. Configuration persists in the `local-projects` entry's volatile `catalogJson` setting. It contains project links and conventions, never tokens or cached issue data. Keep private runtime configuration outside Git. Concurrent saves use a revision check and reject stale edits.

## Configure local projects

The first version uses a JSON editor. Start with an empty catalog, or use this synthetic example:

```json
{
  "teams": [
    {
      "id": "platform",
      "name": "Platform",
      "conventions": {
        "workSelection": "Choose work marked Ready after confirming ownership.",
        "workflow": "Review means implementation is complete but not merged.",
        "development": "Run the repository's documented validation before opening a PR.",
        "agentBoundaries": "Propose tracker changes; request approval before applying them."
      }
    }
  ],
  "projects": [
    {
      "id": "console",
      "name": "Console",
      "description": "Application work across two trackers.",
      "teamId": "platform",
      "sources": [
        {
          "id": "repository",
          "kind": "github-repository",
          "owner": "example-org",
          "repo": "console"
        },
        {
          "id": "planning",
          "kind": "linear-project",
          "project": "11111111-1111-4111-8111-111111111111"
        }
      ],
      "conventions": {
        "issueStructure": "Include acceptance criteria and rollout risks."
      }
    }
  ]
}
```

Replace the example targets with your explicit source identifiers. Use the existing GitHub or Linear read tools to discover identifiers if needed; this page does not automatically enumerate your account.

Supported sources:

| `kind`              | Required target fields            |
| ------------------- | --------------------------------- |
| `github-repository` | `owner`, `repo`                   |
| `github-project`    | `owner`, positive `projectNumber` |
| `linear-project`    | `project`: stable project UUID    |
| `linear-team`       | `team`: stable team UUID          |

Every source also needs a unique `id` within its local project. Local project and team IDs accept letters, numbers, hyphens, and underscores, starting with a letter or number. Linear links require UUIDs rather than names so a renamed resource does not silently redirect a link. Linear reads still enforce the integration's workspace binding.

Limits: 100 teams, 100 projects, 10 sources per project, and 256 KiB of normalized configuration. Names are limited to 200 characters; each convention is limited to 8,000 characters. Unknown properties, duplicate IDs, invalid targets, and missing team references are rejected.

## Team conventions

The supported fields are `workSelection`, `workflow`, `issueStructure`, `development`, and `agentBoundaries`. A project inherits its selected team's values. A project value replaces that field; an empty string explicitly clears it. The page identifies the origin of each effective value.

Conventions are descriptive context, not executable filters, approval policies, or permission grants. They do not override user instructions, tool restrictions, or provider authorization. Projects does not automatically inject them into every agent prompt; an agent reads them explicitly with `projects_get`.

## Read behavior

The page fetches one selected source at a time. Requests default to 20 rows and accept at most 50. GitHub repository views include open and closed issues. GitHub Project views can include issues, pull requests, drafts, archived items, or inaccessible items. Linear views use the existing integration's defaults, excluding archived issues unless the underlying integration changes that default.

Use **Next page** when more rows are available. Nested GitHub field or assignee lists can also be partial; warnings remain visible even when there is no next outer page. The page is a bounded summary, not an exhaustive export. Unsupported board values show **Not summarized** with a warning. Long summary strings end with an ellipsis after a 2,000-character bound. Open the native tracker for complete details. Native priority appears when the source supplies it; Projects does not infer GitHub priority from labels or board field names.

Returned tracker text is untrusted. It renders as text, not HTML. External issue links accept only HTTPS `github.com` or `linear.app` URLs without embedded credentials. Reads do not grant write access. Errors omit arbitrary provider diagnostics, which can contain credentials.

## Host architecture

```text
Projects UI -- authenticated Connection RPC --+
                                             +-- ctx.projects
Agent tools ---------------------------------+       |
                                                     +-- ctx.localGitHubReads
                                                     +-- ctx.localLinearReads
```

The provider read services share the runtimes already used by their native tools. They retain native pagination, provider authentication, cancellation, and bounded deadlines. Projects does not invoke tools as its backend or duplicate provider clients.

`ctx.projects` exposes `catalog`, `project`, `issues`, and local-only `configure`. Provider services are optional and resolved for each request. The service cancels active work on disposal and rejects results when project configuration changes during a read. It does not cache tracker data.

The `/projects` Connection channel exposes the same operations to the authenticated operator UI. Tools expose only:

- `projects_list`: configured project summaries and source links.
- `projects_get`: one project's effective conventions and source links.
- `projects_list_issues`: one bounded page for a configured `projectId` and `sourceId`.

There is no agent configuration tool or tracker mutation endpoint. Existing GitHub/Linear write tools keep their existing approval requirements. The client registers the `local-projects` entry in `sidebar.panellist` and the matching key in `main`; both are root-scoped and do not create a Session binding.

## Development

Use existing pinned workspace dependencies. No new third-party library is required. After following the repository's dependency setup procedure, run from the repository root:

```sh
node packages/dsh-projects/scripts/build-host.mjs
node packages/dsh-projects/scripts/build-client.mjs
node --test packages/dsh-projects/test/*.test.js
node node_modules/vitest/vitest.mjs run --config vitest.browser.config.mjs packages/dsh-projects/test/browser
node node_modules/@playwright/test/cli.js test packages/dsh-projects/test/real-ui
```

Host and client builds type-check their sources. Tests check generated-artifact freshness; regenerate the committed host and client outputs after source changes. Provider fixtures do not contact GitHub or Linear. Real-shell tests use the repository's disposable DSH host, not a live profile. Browser/runtime evidence does not establish live account access.
