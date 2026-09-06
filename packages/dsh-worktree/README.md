# Worktree workers

Manage Git worktrees from a coordinating DSH session and dispatch fresh background workers into them. The coordinator stays in its original checkout. Workers use fixed creation-time directories; this package does not modify DSH internals, switch session directories, or create sidebar workspace records.

Targets **DSH 0.1.2-rc.1**. Uses its public agent, subagent, sandbox-policy, tool, and background-job APIs. Git and Node.js 22.19 or newer must be available on the **DSH host**. Paths refer to that host's filesystem; remote filesystem or container-path translation is not implemented.

## Install and select the preset

The repository's `personal-web` recipe includes this bundle. It installs the shared `worktreeWorkers` service and makes **Worktree coordinator** (`worktree-coordinator`) available in the agent preset picker. The preset includes Standard's native coding tools, job controls, subagents, workflows, and coordination instructions. No separate worker preset is needed: workers inherit this composition, then receive the restricted tool set described below.

**Before installing, check for an existing preset with ID `worktree-coordinator`.** The bundled system root takes precedence over the usual user root. If a user preset already has this ID, the package shadows it after restart, including for saved sessions and a saved default naming that ID. Copy your existing preset to a different ID and use that copy for new sessions and your default before installing. Existing conversations retain their recorded preset ID; if they must keep resolving the old composition, do not install this bundled root yet. Profiles with customized roster configuration also need the override described below.

1. Apply or update the `personal-web` recipe using the [repository setup instructions](../../README.md#apply-the-starter-profile). For an existing standard Web profile, you can instead run `dsh plugin --profile <profile> add /absolute/path/to/packages/dsh-worktree`, replacing both placeholders.
2. Restart that DSH profile and refresh the page to load the Worktrees tab.
3. Start a new session and select **Worktree coordinator** before sending its first message.
4. Confirm that `worktree_create`, `worktree_list`, `worktree_dispatch`, `job_output`, `job_list`, and `job_kill` are available.

Installation does not write a preset selection, write user settings, modify shipped preset files, or change running sessions. Standard remains the stock default, and a default ID saved in Settings still takes precedence. The ID collision above is an exception to preserving which composition that ID resolves to. Package updates replace this bundled preset for new mounts after restart. To customize it, copy it through DSH's preset copy facility into a new user-authored preset; never edit the installed package copy. User copies do not receive later package changes automatically. Removing the bundle removes its preset root on the next profile start; saved sessions that name this preset then cannot mount it. Keep the bundle installed while those sessions still need it.

### Official Creator skills

The coordinator adds the installed Creator skills to its normal skill catalog through `@deepseek-ai/dsh-skill-filesystem` and keeps Standard's `@deepseek-ai/dsh-tool-skill` row. It loads `cordis-plugin-development` for plugin implementation or review and `editing-cordis-compositions` before composition edits. The preset references the official files; it does not copy their bodies into this package or the persona.

This adds guidance, not Creator runtime tools: `tool-cordis` remains absent, and worker tool restrictions and permissions stay unchanged. Workers can read the relevant `SKILL.md` with their existing file tools. The plugin skill's plain-JavaScript-only restrictions (no imports, TypeScript, or JSX) and `cordis_inspect_*`/`cordis_define`/`cordis_run` workflow apply to dynamic plugins, not static packaged plugins. For static development and review, use repository API contracts, imports, TypeScript/JSX where supported, and normal build/test workflows. Report unavailable dynamic inspection, activation, or composition runtime operations separately; do not bypass restrictions or block static repository work.

The path resolves `@local/dsh-worktree/package.json` from the root host context's deployment `baseUrl`, then resolves `@deepseek-ai/dsh-agent-presets/package.json` from that bundle's dependency scope. It does not resolve from the copied preset's directory or the session working directory. User-root copies therefore need no adjacent `node_modules`; keep the bundle installed in the deployment. The official package is pinned to **0.1.2-rc.1**; its internal `presets/cordis/skills` layout is compatibility-tested. If either package cannot resolve, preset mounting fails. If the directory disappears, the upstream filesystem provider omits those skills; the compatibility test fails. Normal skill precedence still applies, so project skills can shadow same-named custom skills.

### Custom profile configuration

The automatic roster wiring targets the standard Web profile in **DSH 0.1.2-rc.1**. Apply this bundle after `@deepseek-ai/dsh-web-app`, which supplies the `agent-presets` row. The package exposes its `presets` directory as a configured system-trust root. DSH still discovers its shipped presets and the usual user preset root. This trust label controls preset authoring; it does not elevate worker permissions.

**Cordis replaces the entire roster `config`; it does not merge root arrays.** This bundle supplies `default: standard` and its own root. If your profile sets a different configuration default, additional roots, or discovery flags, retain them in a later profile override with the complete configuration and the worktree root. Likewise, a later override that replaces `config` without retaining the worktree root removes this preset from discovery. Copy the root expression from [`cordis.patch.yml`](cordis.patch.yml); it resolves the installed package from the profile's `baseUrl`, not from the session directory. A root with an earlier matching ID wins; check for an existing `worktree-coordinator` preset before installation.

The bundle's service belongs in the host composition. Its tool row belongs in the agent preset and consumes that shared service; do not isolate it from the service or move the service into a preset.

### Add the tools to another preset

To keep using an existing customized native-tool preset, copy it into a new user-authored preset, add [`agent.cordis.example.yml`](agent.cordis.example.yml), and retain its `@deepseek-ai/dsh-tool-jobs` row. Mount-validate the result before starting a real session. PTC-only presets are not supported. The bundled [coordinator composition](presets/worktree-coordinator/agent.cordis.yml) also provides reusable coordination guidance.

## Read-only Worktrees tab

The **Worktrees** conversation tab appears only when the viewed live session has this integration's registered capability. Copied presets work if they retain the integration; the preset name alone does not enable the tab. The tab lists repository Git worktrees, shows worker status separately from Git changes, and lets you copy the selected checkout path. It provides no create, dispatch, cancel, merge, delete, or other mutation controls.

Assignments, reports, and recorded run counts belong only to the viewed session. History is process-local and retains at most 100 runs per live session, with reports limited to 32,000 characters. Restarting the harness or unloading the session loses this history. Counts are not lifetime totals. Repository-wide worker status can indicate another session's activity, but does not reveal its assignments or reports.

While the page is visible and the tab is mounted, job subscriptions and 10-second polling refresh its data. Returning to the page also triggers a refresh; **Refresh** requests one manually. Refresh preserves the resolved checkout and run, including an initially automatic selection. If either disappears, the tab keeps that selection unavailable instead of switching to another one. An empty history selects its first arriving run, then preserves that run until you choose another selection. Remounting the tab resets selection.

Git inspection includes tracked and untracked files, but excludes ignored files and submodule changes. It shows no inline diffs and does not refresh the Git index. Lists are bounded to 100 worktrees and 500 changed files per checkout. Bare, prunable, inaccessible, or unsafe checkouts can have unavailable Git status; configured executable status filters are refused.

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
3. Finish independent coordination work while the jobs run. When only workers remain, end the turn with a brief progress update naming pending jobs and the next action. After completion notifications arrive, collect each report with `job_output`; do not use `wait: true` merely to supervise workers.
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

Jobs use DSH's existing `job_list`, `job_output`, and `job_kill`. The bundled preset explicitly sets `tool-jobs` to `completionDelivery: wakeup` and `maxConsecutiveWakes: 10`, instead of the upstream default budget of three. An idle coordinator receives up to ten consecutive completion-driven followup turns. A busy coordinator receives an injected notice without a duplicate followup turn. Claiming a human user message from the inbox resets the budget; merely inserting a message or claiming a plugin notice does not. After budget exhaustion, completions remain queued for a later turn rather than waking the coordinator. This uses the existing upstream controller, not an unbounded scheduler or a core DSH change, and grants no broader tools or permissions.

Yielding ends the current turn, not the task. Give a brief progress update rather than a completion report while workers remain. Do not create an automatic goal solely to supervise workers. Keep existing goals truthful: pending workers alone do not justify marking a goal complete or blocked.

The default job registry admits ten running/stopping jobs per owner, shared with other background tools; it refuses admission at capacity instead of queueing. This concurrency limit is separate from the wake budget.

A job owns cancellation independently of its dispatch tool call. Completion waits for worker disposal before releasing the checkout assignment. Cancelling retains partial file changes. The worker's resources are disposed, but its worktree is not deleted. If cleanup fails, the checkout remains busy with `cleanupUncertain: true`; investigate the remaining resources before restarting the host. The plugin does not offer a force-unlock that could overlap an orphaned worker.

Jobs and report mappings are **process-local**. They do not survive a harness restart, and disposing the coordinating agent cancels its jobs. Completing the coordinator's current turn is not disposal. Durable worktrees and file changes remain; this package provides no automatic restart recovery or reusable worker inbox. Saved session history depends on the deployment's normal session persistence. Plugin reload clears its handoff-report cache, but active checkout fences are reconstructed from the existing job registry. Cleanup-failure fences last while their owner/job records remain; inspect uncertain resources before disposing that owner or restarting the host.

Dispatch uses DSH's public one-shot subagent registry with a single-use provider, preserving native `subagent/start` and `subagent/end` events. The provider registration is removed after startup; the accepted run remains owned by the parent and job until disposal.

No changes to the Environment plugin are necessary: it already reads the viewed live session's directory. Native subagent navigation is reused through parent lineage and one-shot descriptors; this package registers no top-level workspaces or persistent UI.

## Development

The bundled composition is a snapshot of `@deepseek-ai/dsh-agent-presets` **0.1.2-rc.1** Standard, with coordinator persona guidance, one worktree-tools row, an official Creator skill-directory reference, and explicit bounded completion-wake configuration. It does not dynamically inherit future Standard changes. The upstream MIT notice is retained in `presets/worktree-coordinator/LICENSE.standard`. When updating DSH, compare the Standard rows and their isolate realms before updating this snapshot.

From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @local/dsh-worktree test
pnpm run check
pnpm test
```

Worker tests use temporary Git repositories, the real DSH agent loop and job registry, fake model streams, and inert tool bodies. They cover authority checks, cancellation, ownership, service reload, and disposal. Completion tests mount the installed upstream `tool-jobs` controller in a real agent scope and exercise idle followup, busy injection without duplicate followup, budget exhaustion, and human-message claim reset. Preset tests use the pinned CLI's patch, interpolation, discovery, and standing-mount APIs with temporary profile paths. The complete Standard and coordinator compositions, plus a coordinator copy made through the roster API in a separate user root without adjacent dependencies, mount on the same isolated host with real dormant services. Tests check tool scoping, service isolation, unchanged saved settings, root collisions, and exact Standard structure. They do not call a paid model, modify the running GUI, or validate a real kernel sandbox or the browser child catalog. Confirm the tool list in a new GUI session after deployment.

Runtime dependencies are exact-pinned packages from the official MIT-licensed [DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness), already used by this repository. The skill-directory reference declares the already-used official `dsh-agent-presets` package as a direct dependency; it introduces no new vendor or package version. Review public contracts and rerun lifecycle/security tests before changing the DSH pin.
