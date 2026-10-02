# Worktree workers

Manage Git worktrees from a coordinating DSH session and dispatch fresh background workers into them. The coordinator stays in its original checkout. Workers use fixed creation-time directories; this package does not modify DSH internals, switch session directories, or create sidebar workspace records.

Targets **DSH 0.2.0-rc.2**. Uses its public agent, subagent, sandbox-policy, tool, and background-job APIs. Git and Node.js 22.19 or newer must be available on the **DSH host**. Paths refer to that host's filesystem; remote filesystem or container-path translation is not implemented.

Use the repository's target-pinned launcher and approved [profile setup](../../README.md#apply-the-starter-profile). The RPC-owner compatibility patch remains required in every independent launcher/profile graph. See the [migration handoff](../../MIGRATION-0.2.0-rc.2.md) for validation results and limitations. No global DSH installation or live profile changes automatically.

## Install and select the preset

The repository's `personal-web` recipe includes this bundle. Its shared `worktreeWorkers` service registers the worktree tools across presets, including **Standard**. You do not need a separate mode or changes to the shipped Standard preset. Normal session tool filters still apply; restricted worktree workers do not receive these tools or the tab.

The bundle also makes **Worktree coordinator** (`worktree-coordinator`) available in the agent preset picker. This optional preset includes Standard's native coding tools, job controls, subagents, workflows, specialized coordination instructions, and an explicit ten-wake completion budget. No separate worker preset is needed: workers inherit their coordinator's composition, then receive the restricted tool set described below.

**Before installing, check for a preset ID collision with `worktree-coordinator`.** DSH 0.2.0-rc.2 registers explicit declarations and rejects duplicate `config.id` values; it does not select a winning directory root. With approval, reconcile conflicting declarations before installation. Saved sessions retain their preset IDs, so preserve the declaration each retained session needs. Convert any custom directory-discovered presets into explicit declarations before relying on them in this target version.

1. With explicit installation and profile-write approval, apply or update `personal-web` through the [repository setup instructions](../../README.md#apply-the-starter-profile). For another target-compatible Web profile, use the verified checkout-local launcher to add this package after the Web bundle. Review any existing profile patch before replacement; do not use an unrelated global launcher.
2. Restart that DSH profile and refresh the page to load the Worktrees tab.
3. Start a **Standard** session. You can optionally select **Worktree coordinator** for its specialized coordination instructions and explicit ten-wake completion budget.
4. Confirm that `worktree_create`, `worktree_list`, `worktree_dispatch`, `job_output`, `job_list`, and `job_kill` are available.

The declaration uses Loader row ID `local-preset-worktree-coordinator` and stable session identity `config.id: worktree-coordinator`. Standard remains the deployment default. The registry's volatile `selectedDefault` value overrides `default` for new sessions; the old `agent-presets/default` settings field is not migrated by this bundle. Review and restore an intended default explicitly during an approved profile migration. No saved session IDs are rewritten.

To customize the preset, author an explicit `@deepseek-ai/dsh-agent-preset` declaration or a reviewed bundle override; never edit installed package files. There is no directory discovery or roster `copy()` API in this version. Active agents retain their mounted revision, while later agents use the current declaration. Removing the bundle makes its ID unavailable for new mounts, including restored sessions naming that ID. Keep the bundle installed while those sessions or its Creator skill reference still need it.

### Official Creator skills

The coordinator adds the installed Creator skills to its normal skill catalog through `@deepseek-ai/dsh-skill-filesystem` and keeps Standard's `@deepseek-ai/dsh-tool-skill` row. It loads `cordis-plugin-development` for plugin implementation or review and `editing-cordis-compositions` before composition edits. The preset references the official files; it does not copy their bodies into this package or the persona.

This adds guidance, not Creator runtime tools: `tool-cordis` remains absent, and worker tool restrictions and permissions stay unchanged. Workers can read the relevant `SKILL.md` with their existing file tools. The plugin skill's plain-JavaScript-only restrictions (no imports, TypeScript, or JSX) and `cordis_inspect_*`/`cordis_define`/`cordis_run` workflow apply to dynamic plugins, not static packaged plugins. For static development and review, use repository API contracts, imports, TypeScript/JSX where supported, and normal build/test workflows. Report unavailable dynamic inspection, activation, or composition runtime operations separately; do not bypass restrictions or block static repository work.

The path resolves `@local/dsh-worktree/package.json` from the root host context's deployment `baseUrl`, then resolves `@deepseek-ai/dsh-agent-preset/package.json` from that bundle's dependency scope. It does not depend on the session working directory. The official package is pinned to **0.2.0-rc.2** and supplies the `skills/` directory; target-version compatibility validation is pending. Keep the bundle and its dependency installed. If either package cannot resolve, preset mounting fails. If the directory disappears, the upstream filesystem provider omits those skills; the compatibility test fails. Normal skill precedence still applies, so project skills can shadow same-named custom skills.

### Custom profile configuration

Apply this bundle after `@deepseek-ai/dsh-web-app` in **DSH 0.2.0-rc.2**. Web supplies `agent-preset-registry` and its shipped declarations. This bundle adds its declaration without replacing any preset roster configuration. The final `personal-web` patch keeps `default: standard`; it no longer repeats custom directory roots.

[`cordis.patch.yml`](cordis.patch.yml) contains the complete declaration and its `config.plugins` list. Cordis config overrides replace the complete config object; preserve the stable `config.id`, metadata, and full child list when overriding this row. Preserve any intended `selectedDefault` separately on the registry row. Presets compose capabilities, not security sandboxes, and this declaration does not elevate worker permissions.

The bundle's service and shared tool registration belong in the host composition. Do not move the service into a preset. Existing coordinator and custom-preset tool rows remain compatible dependency consumers; they do not register duplicate tools.

### Use another preset

Custom native-tool presets receive the shared tools without an additional worktree row. Keep the preset's `@deepseek-ai/dsh-tool-jobs` row so you can collect and cancel assignments. Session tool filters can hide the integration. Worker dispatch still requires supported native file or shell tools; PTC-only presets are not supported. The bundled [coordinator declaration](cordis.patch.yml) provides optional reusable coordination guidance.

## Read-only Worktrees tab

The **Worktrees** conversation tab appears when the viewed live session can access this integration's registered `worktree_list` tool. This includes Standard and compatible custom presets when the host bundle is loaded. The preset name does not control visibility; session tool filters still apply. The tab lists repository Git worktrees, shows worker status separately from Git changes, and lets you copy the selected checkout path. It provides no create, dispatch, cancel, merge, delete, or other mutation controls.

Assignments, reports, and recorded run counts belong only to the viewed session. History is process-local and retains at most 100 runs per live session, with reports limited to 32,000 characters. Restarting the harness or unloading the session loses this history. Counts are not lifetime totals. Repository-wide worker status can indicate another session's activity, but does not reveal its assignments or reports.

While the page is visible and the tab is mounted, job subscriptions and 10-second polling refresh its data. Returning to the page also triggers a refresh; **Refresh** requests one manually. Refresh preserves the resolved checkout and run, including an initially automatic selection. If either disappears, the tab keeps that selection unavailable instead of switching to another one. An empty history selects its first arriving run, then preserves that run until you choose another selection. Remounting the tab resets selection.

Git inspection includes tracked and untracked files, but excludes ignored files and submodule changes. It shows no inline diffs and does not refresh the Git index. Lists are bounded to 100 worktrees and 500 changed files per checkout. Bare, prunable, inaccessible, or unsafe checkouts can have unavailable Git status; configured executable status filters are refused.

## Tools

| Tool                | Inputs                                                       | Result                                                                             |
| ------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `worktree_create`   | `name`                                                       | New checkout path and branch; coordinator unchanged                                |
| `worktree_list`     | None                                                         | Registered checkouts, branches, busy state, and this agent's active/latest job IDs |
| `worktree_dispatch` | `worktree`, `task`, optional `mode`, optional `context_from` | Background job ID immediately                                                      |

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

Jobs use DSH's existing `job_list`, `job_output`, and `job_kill`. The bundled preset explicitly sets `tool-jobs` to `completionDelivery: wakeup` and `maxConsecutiveWakes: 10`, instead of the target Standard default with no consecutive-wake cap. An idle coordinator receives up to ten consecutive completion-driven followup turns. A busy coordinator receives an injected notice without a duplicate followup turn. Claiming a human user message from the inbox resets the budget; merely inserting a message or claiming a plugin notice does not. After budget exhaustion, completions remain queued for a later turn rather than waking the coordinator. Standard retains its own completion-wake configuration; exposing the worktree tools does not change its wake policy. This uses the existing upstream controller, not an unbounded scheduler or a core DSH change, and grants no broader worker tools or permissions.

Yielding ends the current turn, not the task. Give a brief progress update rather than a completion report while workers remain. Do not create an automatic goal solely to supervise workers. Keep existing goals truthful: pending workers alone do not justify marking a goal complete or blocked.

The default job registry admits ten running/stopping jobs per owner, shared with other background tools; it refuses admission at capacity instead of queueing. This concurrency limit is separate from the wake budget.

A job owns cancellation independently of its dispatch tool call. Completion waits for worker disposal before releasing the checkout assignment. Cancelling retains partial file changes. The worker's resources are disposed, but its worktree is not deleted. If cleanup fails, the checkout remains busy with `cleanupUncertain: true`; investigate the remaining resources before restarting the host. The plugin does not offer a force-unlock that could overlap an orphaned worker.

Jobs and report mappings are **process-local**. They do not survive a harness restart, and disposing the coordinating agent cancels its jobs. Completing the coordinator's current turn is not disposal. Durable worktrees and file changes remain; this package provides no automatic restart recovery or reusable worker inbox. Saved session history depends on the deployment's normal session persistence. Plugin reload clears its handoff-report cache, but active checkout fences are reconstructed from the existing job registry. Cleanup-failure fences last while their owner/job records remain; inspect uncertain resources before disposing that owner or restarting the host.

Dispatch uses DSH's public one-shot subagent registry with a single-use provider, preserving native `subagent/start` and `subagent/end` events. The provider registration is removed after startup; the accepted run remains owned by the parent and job until disposal.

No changes to the Environment plugin are necessary: it already reads the viewed live session's directory. Native subagent navigation is reused through parent lineage and one-shot descriptors; this package registers no top-level workspaces or persistent UI.

## Development

The inline declaration derives from `@deepseek-ai/dsh-web-app` Standard at [tag `dsh-v0.1.7-rc.2`](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/web-app/presets/standard.patch.yml), commit `477b4f420553e8a52c2fbccc464d7561b239c443`. It preserves coordinator guidance, the inert worktree-tools row, Creator skills, and the ten-wake budget. It also deliberately retains enabled Ralph with `maxRounds: 64`, although target Standard disables Ralph. The declaration adopts `workflow-ptc` and the disabled plugin-manager row from target Standard. It does not dynamically inherit future Standard changes. The upstream MIT notice remains in `presets/worktree-coordinator/LICENSE.standard`; compare the complete Standard structure and isolated service scopes before another upgrade.

From the repository root, with the exact target dependencies already installed through the approved repository setup procedure:

```sh
env -u NODE_PATH node packages/dsh-worktree/scripts/build-host.mjs
env -u NODE_PATH node packages/dsh-worktree/scripts/build-client.mjs
env -u NODE_PATH node --test packages/dsh-worktree/test/*.test.js
node scripts/check.mjs
git diff --check
```

Maintained host modules use strict TypeScript in [`src/`](src/); the client uses modular TypeScript and TSX in [`client/`](client/). The package exports checked ESM from [`dist/`](dist/) and the generated lazy browser bundle [`client.js`](client.js). Package builds use the pinned root compiler and shared build helpers. Run either build command with `--check` to verify committed artifact freshness without writing. The normal Node test suite checks both artifacts and strict contracts. Regenerate artifacts after source changes before packaging.

These validation commands do not install dependencies or apply a profile.

Worker tests use temporary Git repositories, the real DSH agent loop and job registry, fake model streams, and inert tool bodies. They cover authority checks, cancellation, ownership, service reload, and disposal. Completion tests mount the installed upstream `tool-jobs` controller in a real agent scope and exercise idle followup, busy injection without duplicate followup, budget exhaustion, and human-message claim reset. Preset tests mount the real target registry and explicit declarations through Loader with temporary deployment paths. They check exact Standard parity, deferred expressions, tool and skill scoping, isolated services, volatile default selection, duplicate-ID rejection, and retained revision release. RPC fixtures run the installed host/browser parser and serializer with simulated socket/auth admission boundaries; they do not establish live authentication. UI selection follows the target session catalog's uniquely retained `mainView`, and job refreshes use the target Jobs state subscription. They do not call a paid model, modify the running GUI, or validate a real kernel sandbox or the browser child catalog. Confirm the tool list in a new GUI session after deployment.

Runtime dependencies are exact-pinned packages from the official MIT-licensed [DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness), already used by this repository. The Creator skill reference uses the official `dsh-agent-preset` package's `skills/` directory. Fresh worker assignment messages use the V4 producer kind `plugin:dsh-worktree`; old `{ kind: 'plugin', plugin: ... }` sources are not emitted. Job ownership uses session IDs, and completion reports consume the target `result` field. Review public contracts and rerun lifecycle/security tests before changing the DSH pin.
