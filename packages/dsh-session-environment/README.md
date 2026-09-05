# @local/dsh-session-environment

A local DSH Web bundle that shows the selected session's working directory and current Git state in a compact `shell.overlay` Environment card. It targets DSH `0.1.2-rc.1`.

## Behavior

- Polls only the selected session every 3 seconds.
- Caches results by working directory, delays the initial “Checking…” label by 300 ms, and ignores stale responses to avoid flicker during session switches and checkouts.
- Displays the home-relative, middle-truncated CWD with the full native path in a tooltip.
- Displays the current branch (or detached short SHA), its tracked upstream, and local commit divergence (`↑` ahead, `↓` behind).
- Upstream divergence uses the locally cached remote-tracking ref and never runs `git fetch`; tooltips identify it as the last-fetched state.
- Displays the dirty-file count and tracked added/deleted line totals. Untracked and binary files count as dirty but do not add line totals.
- Handles non-repositories and repositories without a first commit explicitly.
- Bounds each Git probe to 4 seconds and 1 MiB of captured stdout by default.

The host reads `session.header.cwd` for the requested session. Sessions sharing a checkout therefore show the same Git state. This bundle does not create worktrees or change session directories.

## Architecture

The host plugin extends `TypertRemoteService` and publishes a strict `sessionEnvironment/read` Typert descriptor. The browser bundle self-mounts the matching Remote contribution and registers the card in `shell.overlay`. Timers, calls, Remote contributions, and Slot registrations follow their owning Cordis/React lifecycle.

The wire artifacts are explicit TypeScript modules rather than generator output because the published Typert generator expects the protocol package to be registered from the full DSH source workspace. Both host and client use the same Zod contract, and the build bundles the client codec.

This package was imported from the user-owned `tools/dsh` repository's `packages/dsh-session-environment` at revision `4cea852`. The TypeScript source and unit tests remain unchanged. The package keeps its `@local` identity because its self-imports, client loader ID, and Typert descriptors depend on that name.

## Build and test

From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm --filter @local/dsh-session-environment test
pnpm --filter @local/dsh-session-environment test:integration
```

The build type-checks both faces and generates host JavaScript, browser JavaScript, declarations, and maps under `lib/`. The bundler config uses `.mjs` with an explicit native loader. Only its original three TypeScript parameter annotations were removed. This avoids tsdown's optional `unrun` loader and supports Node builds without built-in TypeScript stripping; the plugin source remains TypeScript. Generated output and dependencies are not committed. Root `pnpm test` builds the package explicitly before running its tests alongside the existing suites; installation scripts are not required.

The integration tests check the local recipe, bundle metadata, generated entrypoints, Remote descriptor identity, and apply dry run. They replace the original standalone Web boot smoke test. They do not install a profile or start a DSH server. The existing browser and real-UI suites do not yet cover this card.

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

The import retains exact pins from the existing plugin rather than introducing a replacement toolchain. [TypeScript's official download guide](https://www.typescriptlang.org/download/) identifies `typescript` (`microsoft/TypeScript`, Apache-2.0). [tsdown's installation guide](https://tsdown.dev/guide/getting-started) identifies `tsdown` (`rolldown/tsdown`, MIT). [Zod's documentation](https://zod.dev/) identifies `zod` (`colinhacks/zod`, MIT). Node and React type declarations come from `DefinitelyTyped/DefinitelyTyped` (MIT). DSH dependencies match the repository's pinned `0.1.2-rc.1` runtime.

Registry metadata confirms these owners, licenses, and maintained release lines. TypeScript and Zod are established ecosystem dependencies; tsdown is the existing plugin's newer bundler, maintained under the Rolldown project. The download-count endpoint was unavailable during this import, so current adoption counts were not verified. The registry advisory check reported no vulnerabilities in the resolved graph at import time; rerun `pnpm audit` when updating dependencies.

Installs disable lifecycle scripts. The reviewed direct compiler, bundler, validator, and type packages have no install hooks. tsdown uses platform-specific Rolldown native binaries distributed through npm; the lockfile pins their graph. Review those binaries and transitive dependencies when upgrading the toolchain.
