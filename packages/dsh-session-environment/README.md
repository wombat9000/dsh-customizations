# @local/dsh-session-environment

A local DSH Web bundle that shows the selected session's working directory and current Git state in a compact `shell.overlay` Environment card. It targets DSH `0.2.1-rc.3`.

## Behavior

- Shows the floating, multi-row card only while the unique selected session's Chat view is on screen. Trajectory, other tabs, global pages, and the blank-session setup screen hide it. Opening that session's right sidebar also hides the card in normal, fullscreen, and narrow layouts; closing the sidebar restores it in Chat. Retained background views and sidebars do not show or hide it.
- Polls local Git for the unique session retained by `mainView` every 3 seconds while the card is visible. Hidden browser pages, non-Chat views, open sidebars, no selection, and multiple main-view selections suspend polling.
- Shows live CI independently of conversation activity when the optional GitHub host integration is available. The current row covers the checked-out branch's single open PR head. The default row covers the repository's latest remote default-branch commit; GitHub supplies the default branch name; a small branch-ref lookup resolves its commit without downloading file patches. Checking out the default branch deduplicates the rows.
- Shows a fixed-width segmented CI indicator with one equal partition per reported job/check. Green means passed, yellow means running, gray means pending, and red means failed; other outcomes use muted stripes. Hover reveals the check name and state; keyboard focus provides the same label with arrow-key navigation. Clicking opens GitHub. The bar represents check states, not elapsed work or time remaining. Older aggregate-only GitHub providers keep their status text without invented partitions.
- Shows “Started 3m ago” for an active bar using the earliest valid reported section start, including earlier sections that have finished. The label updates locally at minute/hour/day boundaries while the card is visible; GitHub polling is unchanged. Completed bars hide the timer. “Queued” appears only when all reported sections are known not to have started. Missing timestamps and partial collections do not invent a start time.
- Identifies each checked commit with a short SHA and GitHub checks link. Refresh-age text is omitted; success and running labels are omitted when the complete check bar supplies the status. Stale warnings, incomplete results, and errors remain visible. A `≠` beside the CI commit hash marks a local commit mismatch, with the tooltip “CI covers another commit”; matching commits show no icon. Ahead/behind counts remain exclusive to Sync. Cached reads retain their original observation time and freshness expiry; the remaining refresh delay does not determine freshness. No checks, partial collections, unknown, cancelled, skipped, and neutral checks do not appear as success. Ambiguous repositories or PRs never select a target automatically.
- Keeps the verified default row when current-PR discovery or checks fail. Each failed row shows unknown and an error instead of claiming success from incomplete evidence. An overall error is omitted when a row already displays the same message; distinct and snapshot-only errors remain visible. Failures use network backoff; a whole-observation failure retains prior rows with their original timestamps and a stale warning. If repository metadata cannot be read and no prior rows exist, only an unavailable message is shown.
- Refreshes remote CI separately, normally every 25 seconds for pending, running, failed, missing, or unknown checks and 60 seconds for other completed checks. GitHub bounds pagination, caches reads, deduplicates requests, and backs off failures up to 5 minutes. It makes no background PR changes or agent/model calls.
- Caches results by working directory, delays the initial “Checking…” label by 300 ms, and ignores stale responses to avoid flicker during session switches and checkouts.
- Displays the home-relative, middle-truncated CWD with the full native path in a tooltip.
- Displays the current branch (or detached short SHA), its tracked upstream, and local commit divergence (`↑` ahead, `↓` behind).
- Upstream divergence uses the locally cached remote-tracking ref and never runs `git fetch`; tooltips identify it as the last-fetched state.
- Displays the dirty-file count and added/deleted line totals, including untracked text files as additions. Counts individual files inside new directories and excludes ignored files. Binary files and untracked symlinks count as dirty but do not add line totals; the probe does not follow those symlinks or stage files.
- Handles non-repositories and repositories without a first commit explicitly.
- Bounds each Git probe to 4 seconds and 1 MiB of captured stdout by default.

The host reads DSH's effective working directory for the requested session, including native `working_directory` and `create_worktree` changes. Sessions sharing a checkout show the same Git state. This bundle does not create worktrees or change session directories itself.

## Worktree mode

**Worktree** appears beside the workspace and preset controls before the first prompt. After a session starts, it moves to the composer toolbar. It is a workflow preference, not enforced isolation or a permission grant. Native workspace, preset, model, and permission controls remain unchanged.

- The first default is Off. Your last saved choice becomes the default for new top-level sessions, including new forks. Each session retains its own choice on resume. Existing sessions without a saved choice start Off; loading the plugin does not apply a newer default to them.
- When On, the agent receives guidance to investigate without creating a worktree, then prefer DSH's supplied `create_worktree` tool before code changes. Creation starts from the selected checkout's current `HEAD`. The native tool enters the worktree; `working_directory` remains the directory owner. A suitable worktree already in use for the task can be reused.
- Uncommitted and untracked changes stay in the original checkout. If the task depends on them, the guidance asks the agent to clarify before proceeding. Missing native tools, unavailable Git, and failed creation require an explanation and a question before editing the original checkout.
- Off removes the preference on subsequent prompt assemblies. It does not interrupt a dispatched request, switch directories, merge branches, or delete worktrees. The Environment card continues to show the active path and branch.
- Non-Git folders and repositories without a first commit cannot enable the preference. A saved On remains visible as inactive when its directory becomes unavailable; you can still save Off. Probe failures are not treated as confirmed non-repositories.
- The toggle changes only a user-owned preference. Agents cannot silently change it through the service. Delegated agents have no toggle or implicit saved choice; the lead's guidance tells it to pass the chosen directory and preference to delegates.

The `personal-web` recipe selects DSH's shipped **Git Worktrees** bundle, which mounts the native runtime and `create_worktree` tool. Session Environment does not replace them. In another profile, enable **Plugins → Official → Git Worktrees** before enabling the preference. The toggle reports unavailable support rather than promising creation when the native runtime is absent. No retired Worktree coordinator or saved-state migration returns. Apply/restart remains a separate approved deployment step.

## Architecture

The host plugin extends `TypertRemoteService` and publishes strict `sessionEnvironment/read`, `sessionEnvironment/readCI`, `sessionEnvironment/readWorktreePreference`, and `sessionEnvironment/setWorktreePreference` Typert descriptors. One plugin-owned storage domain atomically saves session choices and the next-session default. A serial agent-creation listener initializes new choices before creation resolves. The public prompt registry contributes session-dependent advisory text; no tool guard or filesystem policy enforces it. The client uses the additive `conversation.hero.options` and `conversation.input.left` lists, waits for native session opening, and ignores late reads or saves after identity changes. Managed shell probes supply the session checkout identity; the browser receives only its digest, never remote credentials. Identity probes bracket local Git sampling; a detected checkout change discards the combined snapshot. The CI endpoint checks that identity before and after the optional host-only `localGitHubLiveCI.readCheckout` call. GitHub owns authentication, API reads, commit validation, bounded pagination, caching, network cancellation, and backoff through its existing managed `gh` backend. Environment owns live session/checkout validation and visibility-driven consumption. Missing GitHub does not affect local Git data. The browser bundle self-mounts the matching Remote contribution and registers the card in `shell.overlay`. Timers, calls, Remote contributions, and Slot registrations follow their owning Cordis/React lifecycle.

The card uses the injected `usePanelInfo` hook to distinguish Conversation from global pages. Its React-owned visibility stylesheet requires the selected session's foreground Chat flow inside the main Conversation and hides the card when that session's sidebar is open. The visibility hook observes only relevant shell marker and hidden-ancestor changes, coalesces layout reads into an animation frame, and ignores streamed text and unrelated class/style mutations. It depends on DSH `0.2.1-rc.3`'s slot, Chat, session, overlay, and sidebar data markers, not tab labels, compiled CSS classes, or a sidebar-width API. Recheck this markup contract when upgrading DSH.

The wire artifacts are explicit TypeScript modules rather than generator output because the published Typert generator expects the protocol package to be registered from the full DSH source workspace. Both host and client share protocol-typed descriptors with lazy `create()` codec factories and strict Zod validation. The build bundles the client codec. The host awaits `shell.execute(spec)` and then the execution handle's `result()`.

This package was imported from the user-owned `tools/dsh` repository's `packages/dsh-session-environment` at revision `4cea852`. The compatibility migration updates the TypeScript contracts and regression tests for the target runtime. The package keeps its `@local` identity because its self-imports, client loader ID, and Typert descriptors depend on that name.

## Build and test

See the [DSH `0.2.1-rc.3` validation results](../../MIGRATION-0.2.1-rc.3.md#validation-results) for shell-marker checks, screenshot outcomes, and remaining limits.

After the approved dependency setup, run from the repository root:

```sh
env -u NODE_PATH pnpm --filter @local/dsh-session-environment test
env -u NODE_PATH pnpm --filter @local/dsh-session-environment test:integration
```

Both commands build first. Host and browser checks use `tsc -b --force` so stale incremental metadata cannot hide target dependency changes. The normal tests validate generated artifacts with the installed launcher's real Typert loader, reject obsolete eager codecs, and check strict validation and main-view session selection.

The build type-checks both faces and generates host JavaScript, browser JavaScript, declarations, and maps under `lib/`. The bundler config uses `.mjs` with an explicit native loader. Only its original three TypeScript parameter annotations were removed. This avoids tsdown's optional `unrun` loader and supports Node builds without built-in TypeScript stripping; the plugin source remains TypeScript. Generated output and dependencies are not committed. Root `pnpm test` builds the package explicitly before running its tests alongside the existing suites; installation scripts are not required.

The integration tests check the local recipe, bundle metadata, generated entrypoints, Remote descriptor identity, and apply dry run. They replace the original standalone Web boot smoke test. They do not install a profile or start a DSH server. Browser tests cover copy feedback, selection and global-page guards, sidebar visibility, CI rows, stable freshness, visibility overhead, remote cadence, and late-response cleanup with real React and mocked RPC. Real-UI tests use the existing disposable host to cover Remote reads, session switching, global pages, and normal, restored fullscreen, and narrow Files sidebars. The Environment journey also loads a real disposable Git checkout and a fixture-only `gh` executable to check current-PR/default rows and capture a diagnostic image. It makes no live GitHub or model request and does not establish live authentication, OS sandbox enforcement, deployment, or visual-baseline compatibility. These suites require built artifacts and the repository's browser prerequisites.

## Install

Build the package before applying the `personal-web` recipe:

```sh
pnpm run build
pnpm run apply -- personal-web --dry-run
pnpm run apply -- personal-web
```

To install only this bundle into another existing Web profile, replace `web` with that profile's name:

```sh
pnpm exec dsh plugin --profile web add ./packages/dsh-session-environment
```

The recipe uses this repository's local package, not a machine-specific external source. An existing installation under the same package name keeps its identity when reinstalled from this path. Importing the source into this repository does not update a running profile.

Restart the target DSH Web process, then refresh its existing browser page. Typert package discovery is process-cached, so the first installation cannot be activated by a page refresh alone.

## Dependency provenance

The import retains exact pins from the existing plugin rather than introducing a replacement toolchain. [TypeScript's official download guide](https://www.typescriptlang.org/download/) identifies `typescript` (`microsoft/TypeScript`, Apache-2.0). [tsdown's installation guide](https://tsdown.dev/guide/getting-started) identifies `tsdown` (`rolldown/tsdown`, MIT). [Zod's documentation](https://zod.dev/) identifies `zod` (`colinhacks/zod`, MIT). Node and React type declarations come from `DefinitelyTyped/DefinitelyTyped` (MIT). DSH dependencies match the repository's pinned `0.2.1-rc.3` runtime.

Registry metadata confirms these owners, licenses, and maintained release lines. TypeScript and Zod are established ecosystem dependencies; tsdown is the existing plugin's newer bundler, maintained under the Rolldown project. The download-count endpoint was unavailable during this import, so current adoption counts were not verified. The registry advisory check reported no vulnerabilities in the resolved graph at import time; rerun `pnpm audit` when updating dependencies.

Installs disable lifecycle scripts. The reviewed direct compiler, bundler, validator, and type packages have no install hooks. tsdown uses platform-specific Rolldown native binaries distributed through npm; the lockfile pins their graph. Review those binaries and transitive dependencies when upgrading the toolchain.
