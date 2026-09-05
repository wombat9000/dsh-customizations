# Worktree workers

Manage Git worktrees from a coordinating DSH session and dispatch fresh background workers into them. The coordinator stays in its original checkout. Workers use fixed creation-time directories; this package does not modify DSH internals, switch session directories, or create sidebar workspace records.

Targets **DSH 0.1.2-rc.1**. Uses its public agent, subagent, sandbox-policy, tool, and background-job APIs. Git and Node.js 22.19 or newer must be available on the **DSH host**. Paths refer to that host's filesystem; remote filesystem or container-path translation is not implemented.

## Install and grant tools

The repository's `personal-web` recipe includes this host bundle. Applying it installs the shared `worktreeWorkers` service, **not the agent tools**. Restart DSH after applying the host bundle; no browser UI bundle is added.

1. Copy your preferred agent preset into a new user-authored preset using DSH's preset copy facility. Never edit the deployment's shipped presets.
2. Add the row in [`agent.cordis.example.yml`](agent.cordis.example.yml) to the copy's `agent.cordis.yml`.
3. Retain the preset's `@deepseek-ai/dsh-tool-jobs` row. It supplies `job_output`, `job_list`, `job_kill`, and completion delivery.
4. Mount-validate the copied preset and start a session using it. Confirm that `worktree_create`, `worktree_list`, and `worktree_dispatch` are available.

The bundle's host row belongs in the host composition. The tool row belongs in the agent preset and consumes the shared service; do not isolate it from the service or move the service into a preset.

## Tools

| Tool | Inputs | Result |
|---|---|---|
| `worktree_create` | `name` | New checkout path and branch; coordinator unchanged |
| `worktree_list` | None | Registered checkouts, branches, busy state, and this agent's active/latest job IDs |
| `worktree_dispatch` | `worktree`, `task`, optional `mode`, optional `context_from` | Background job ID immediately |

`name` is a unique lowercase slug, up to 48 letters, digits, or hyphens, starting with a letter or digit. Creation uses branch `worktree/<name>` at the invoking checkout's current `HEAD` and directory `<original-checkout>/.dsh/worktrees/<name>`. It does not copy uncommitted changes, install dependencies, commit changes, or reuse existing branches. Add `.dsh/worktrees/` to your repository's ignore rules if needed; the plugin does not edit them automatically.

**Creation requires the coordinator's Full access mode**, because Git updates protected shared repository metadata. The plugin refuses lower modes instead of bypassing them or silently escalating. Git post-checkout hooks are disabled for creation. Configured smudge/process filters cause creation to refuse; set up such repositories manually rather than silently bypassing required content transforms.

Creation checks configuration in both the invoking and new checkout, including conditional Git includes. A conditional filter refusal can occur after Git has registered the new branch and checkout; the checkout may contain only its `.git` file. Failed creation preserves that state for explicit inspection rather than deleting branches or files. Complete or remove the partial checkout manually before dispatching work into it.

Dispatch accepts an existing registered linked worktree from this repository, including one created manually. The original checkout, the coordinator's current checkout, bare repositories, and locked or prunable entries are not dispatch targets.

### Example sequence

1. Ask the coordinator to create `login-validation` and `search-pagination`.
2. Dispatch implementation assignments with `mode: write` to both returned paths.
3. Continue coordinating while the jobs run. On completion, collect each report with `job_output`.
4. Dispatch `mode: read-only` review assignments to the same paths. Optionally set `context_from` to the completed implementation job ID.
5. Dispatch fresh write-mode workers to address review findings.
6. Review and integrate retained changes explicitly. The plugin never merges or deletes worktrees.

One-shot means **one assignment**, not one model call. A worker can run many steps and tools. Each subsequent dispatch creates a new session; `send_message` and `interrupt_agent` do not continue these workers. Cancel with `job_kill`.

## Context handoffs

`context_from` includes the prior assignment and bounded final report as reference input. It is not a native fork and does not copy raw session events, prior authority, or permissions. The source must be a completed retained job from the same live coordinator and worktree.

The plugin retains at most 100 recent reports per live coordinator, bounded to 32,000 characters each. Handoffs reserve separate budgets for the prior assignment (4,000 characters) and report (26,000 characters), with explicit truncation markers. Failed or cancelled assignments may have no final report. Inspect the actual checkout rather than assuming the report is complete. For independent review, omit `context_from` and provide requirements and a comparison baseline explicitly.

## Permissions and concurrency

- Workers receive only an audited subset of the coordinator's visible native tools: `read`, `read_image`, `glob`, `grep`, and `bash`, plus `write`/`edit` in write mode. Delegation, worktree-management, external mutation, and dynamic-plugin tools are excluded. Presets exposing only PTC or other tool names are unsupported and may fail startup with no supported tools.
- `read-only` is the default dispatch mode. It enforces read-only filesystem policy rather than relying on a prompt instruction.
- `write` is capped at workspace-write within the selected worktree, even if the coordinator has Full access. A worker cannot automatically approve broader permissions.
- Worker startup fails closed if the required enforcement capabilities or parent authority are unavailable.
- Multiple worktrees can run concurrently. One assignment per canonical worktree path is allowed within this host, including across coordinating sessions. Another DSH process, external editor, or ordinary Bash command is outside this lock.
- Git worktrees share repository metadata. This is file-change isolation, not isolation of ports, databases, network access, or external services. Read-only does not mean network-disabled.

## Job lifecycle and limitations

Jobs use DSH's existing `job_list`, `job_output`, and `job_kill`. Busy coordinators receive completion notices in their inbox; idle coordinators may be woken according to their job-controller configuration. The default controller allows three consecutive automatic wakes before notices remain queued, so this is not an unbounded autonomous scheduler. The default job registry admits ten running/stopping jobs per owner, shared with other background tools; it refuses admission at capacity instead of queueing.

A job owns cancellation independently of its dispatch tool call. Completion waits for worker disposal before releasing the checkout assignment. Cancelling retains partial file changes. The worker's resources are disposed, but its worktree is not deleted. If cleanup fails, the checkout remains busy with `cleanupUncertain: true`; investigate the remaining resources before restarting the host. The plugin does not offer a force-unlock that could overlap an orphaned worker.

Jobs and report mappings are **process-local**. They do not survive a harness restart, and disposing the coordinating agent cancels its jobs. Completing the coordinator's current turn is not disposal. Durable worktrees and file changes remain; this package provides no automatic restart recovery or reusable worker inbox. Saved session history depends on the deployment's normal session persistence. Plugin reload clears its handoff-report cache, but active checkout fences are reconstructed from the existing job registry. Cleanup-failure fences last while their owner/job records remain; inspect uncertain resources before disposing that owner or restarting the host.

Dispatch uses DSH's public one-shot subagent registry with a single-use provider, preserving native `subagent/start` and `subagent/end` events. The provider registration is removed after startup; the accepted run remains owned by the parent and job until disposal.

No changes to the Environment plugin are necessary: it already reads the viewed live session's directory. Native subagent navigation is reused through parent lineage and one-shot descriptors; this package registers no top-level workspaces or persistent UI.

## Development

From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @local/dsh-worktree test
pnpm run check
pnpm test
```

Tests use temporary Git repositories, the real DSH agent loop and job registry, fake model streams, and inert tool bodies. They cover authority checks, cancellation, ownership, service reload, and disposal without calling a paid model or modifying the running GUI. They do not validate a real kernel sandbox, the browser child catalog, or loading a user preset from disk. Runtime dependencies are exact-pinned packages from the official MIT-licensed [DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness), already used by this repository. There are no new third-party runtime libraries. Review public contracts and rerun lifecycle/security tests before changing the DSH pin.
