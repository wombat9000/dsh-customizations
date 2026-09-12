# GitHub tools

This host bundle adds eleven read-only GitHub tools to every DSH session, independent of preset. It targets DSH `0.1.5-rc.1` and `github.com`. It uses the GitHub CLI already available through DSH’s managed subprocess backend; it adds no SDK, login flow, credential store, or client UI.

## Access and execution

Before using the tools, authenticate `gh` in the execution environment used by DSH and grant access to the repositories and projects you want to inspect. The plugin does not install the CLI or change token scopes. Use `github_connection_status` to check the effective account. Unknown permission information is not evidence of permission; successful reads do not establish write access.

Tools can read what the configured account can access. There is no per-session toggle or repository allowlist. Repository discovery does not restrict subsequent calls. An agent with other tools such as Bash may have additional access paths; this bundle does not define a session-wide security boundary.

All subprocesses run through DSH’s managed backend. Do not assume a host process shares a sandbox’s `PATH`, home directory, or CLI credentials. The plugin never runs `gh auth token` or copies tokens into model output. GitHub titles, descriptions, READMEs, issue bodies, and comments are untrusted reference material, not instructions.

## Tool inventory

| Tool | Purpose |
| --- | --- |
| `github_connection_status` | Check CLI availability, effective GitHub account/host, and known permission information. |
| `github_detect_repositories` | Inspect the Git repository containing the calling session’s working directory; return resolved GitHub candidates and source remotes. |
| `github_list_repositories` | List accessible repositories for an explicit owner. |
| `github_get_repository` | Read identity, description, visibility, default branch, and permission information. |
| `github_list_projects` | List an owner’s projects, including template flags and an optional template-only filter. |
| `github_get_project` | Read metadata, description, README, fields/status options, and linked repositories. |
| `github_list_project_items` | Read project items and their field values. |
| `github_list_issues` | List repository issues using state, label, and assignee filters. |
| `github_search_issues` | Search issue text within an explicit repository or owner scope. |
| `github_get_issue` | Read an issue, hierarchy, and native blocking dependencies. |
| `github_get_issue_comments` | Read paginated comments for an issue. |

Repository- and owner-scoped tools require explicit targets. Repository, project owner, and template owner are separate identities: for example, a repository under a user account can use an organization-owned project template later.

- Repository target: `owner` plus `repo`, for example `{ "owner": "wombat9000", "repo": "dsh-customizations" }`.
- Project target: `owner` plus `projectNumber`; the number belongs to that owner, not to a repository.
- Issue target: `owner`, `repo`, and `issueNumber`.
- Top-level collections: `limit` (default 20, maximum 50) and `cursor` from that connection’s `nextCursor`.
- Issue relationships: repeat the issue target with the appropriate `labelsCursor`, `assigneesCursor`, `subIssuesCursor`, `blockedByCursor`, or `blockingCursor`.
- Project metadata: `fieldsCursor` and `repositoriesCursor` advance independently.
- Project items: outer `cursor` pages items. Use `itemId` with `fieldValuesCursor` to page one item’s fields. To continue values inside one field, also set `fieldValuesLimit: 1`, retain the cursor immediately before that field, and pass its nested `nextCursor` as `valueCursor`.

Issue search accepts literal text, not arbitrary GitHub search syntax. Quotes, qualifiers, Boolean operators, parentheses, and backslashes are rejected so search text cannot override the explicit repository/owner scope. Use `github_list_issues` for structured state, label, and assignee filters. A template-only project page can be empty while still having a next cursor; continue until the underlying project collection is exhausted.

Discovery normalizes GitHub SSH and HTTPS remotes and reports ambiguity, including fork/upstream alternatives. It examines the containing Git repository, not every nested repository. It does not save a selection, change remotes, clone repositories, or change the targets used by later calls.

## Results and limitations

- Reads use fixed queries and validated arguments, not an unrestricted API or shell tool.
- Collections are bounded and expose continuation information. Nested collections also need pagination; do not treat a first page as the complete project or issue graph.
- Large text and output are bounded. Truncation is reported rather than silently presented as complete data.
- Reads support cancellation, timeouts, and bounded retries for transient failures. Authentication, permission, and input errors are not evidence that retrying will help.
- GitHub can hide inaccessible resources as nonexistent. Diagnostics retain that ambiguity rather than asserting the resource does not exist.
- Template status is a project property, not a separate resource type.

This layer does not create or modify GitHub data, persist planning state or workspace mappings, dispatch agents, or configure project views/workflows.

## Packaging and validation

The portable `personal-web` recipe selects `@local/dsh-github`. The bundle inserts a host plugin row and does not replace the preset roster. Applying it to a profile and restarting DSH require separate approval; editing this source does not update the running GUI.

Tests use synthetic subprocess results and dormant DSH services, not user credentials or live GitHub writes. With the repository’s existing pinned development dependencies available:

```sh
env -u NODE_PATH node --test packages/dsh-github/test/*.test.js
node scripts/check.mjs
git diff --check
```

Follow the repository setup skill before validation or dependency work. No install is required by this package. Unit/registration tests are not evidence of a deployed GUI or a live GitHub acceptance test.
