---
name: repository-setup
description: Check dependency ownership and pinned tools, prepare an approved offline install, and choose validation commands for this repository in a fresh checkout or worktree.
---

# Repository setup

Use this procedure before dependency work or validation. It is repo-owned Markdown and works without Project Steward or a skill loader. Run commands from the repository root unless stated otherwise. Only the bounded worktree bootstrap below has standing authorization; permission to edit code does not authorize other dependency installs or changes. Always complete the prerequisite checks.

## Verified repository facts

These facts come from repository configuration, not an install result:

- `package.json` pins `pnpm@12.21.0` and supports Node.js `^22.19.0 || >=24.0.0` (not Node.js 23).
- `pnpm-workspace.yaml` sets `minimumReleaseAge: 5760` (4 days in minutes), supported by the pinned pnpm 12.21.0, with exact package-and-version release-age exceptions for the DSH `0.2.2-rc.5` migration. Preserve this policy and inspect overrides before dependency work. The delay is not a safety guarantee. If an urgent security fix needs an exception, obtain explicit approval for a narrow package-and-version exclusion, document its reason and review/removal condition, and keep the global delay enabled. This does not authorize an install or upgrade.
- `pnpm-workspace.yaml` includes `packages/*`; `pnpm-lock.yaml` records the dependency graph. Local bundles live in `packages/`; `profiles/personal-web/recipe.json` selects them through portable relative paths.
- Root `check` runs the dependency-free `node scripts/check.mjs`. Root `test` has a `pretest` hook that runs `build`; build invokes the Session Environment workspace's TypeScript/tsdown host and client builds and writes generated artifacts. Bypassing `pretest` is suitable for scoped tests that do not need those artifacts, not an equivalent full test run.
- `.github/workflows/tests.yml` uses Node.js 24.20.0 and pnpm 12.21.0 in a pinned Linux ARM64 Playwright container. Its existing install allows network access and disables lifecycle scripts. It runs formatting checks, repository checks, unit tests, browser interactions, and visual comparisons. The local offline-first procedure below does not change CI.

## Check safe prerequisites

1. Confirm the checkout with `pwd`, `git status --short`, and `node --version`. Preserve unrelated changes. A new worktree shares Git metadata but does not bring its own `node_modules` from the source checkout.
2. Locate pnpm with `command -v pnpm` on POSIX (or `Get-Command pnpm` on PowerShell), without invoking it. Inspect the executable's symlink target, wrapper, and adjacent package manifest. Establish that the exact 12.21.0 executable and its runtime files are already available. Even `pnpm --version` can trigger provisioning through a shim or version manager. If the pin is unavailable, stop and request approval for provisioning. Do not run `npx`, Corepack preparation, or a package-manager downloader automatically.
3. Inspect root `node_modules` and each `packages/*/node_modules` using lstat/readlink/realpath or equivalent. Inspect parent path components, bind mounts, and `.npmrc`/workspace virtual-store settings too. If any dependency directory is symlinked, shared with another checkout, or has uncertain ownership, **do not install there**. Do not unlink, delete, relink, or mutate another checkout's dependencies automatically. Normal package links inside a checkout-owned pnpm tree are expected; a link to another checkout's whole tree is different. A shared content-addressed cache is not a shared dependency tree.
4. Inspect package-manager configuration, environment overrides, registry settings, and the chosen cache location without printing credentials. Locate an existing accessible cache for this OS/architecture. Directory existence does not establish cache completeness; the offline frozen install below can establish whether locked packages are missing. If the cache is unavailable or the offline attempt reports missing packages, stop and report the limitation. Do not fall back online automatically.

A dependency link explicitly authorized for read-only testing is not authorization to install, build into its target, or modify the parent checkout. Report borrowed dependencies as a validation limitation. Recheck ownership in every fresh checkout/worktree.

## Restore locked worktree dependencies

After the prerequisite checks, you may restore dependencies without another approval question only when all these conditions hold:

- The target is this repository's isolated task worktree. Every dependency tree the command may replace is absent or verified as owned exclusively by that worktree. Shared, borrowed, main-checkout, runtime, and profile dependency trees are outside this authorization.
- The exact pinned pnpm executable is already available and verified. No package-manager or toolchain provisioning is needed.
- You restore the existing checked-in dependency graph. Do not add or upgrade dependencies or change tracked manifests, lockfiles, patches, or package-manager configuration as part of this operation.
- Use only the existing offline cache, keep the lockfile frozen, and disable installation lifecycle scripts. If packages are missing or installation fails, stop and inspect the partial local layout; ask before any download, script execution, or operation outside these conditions.

Using the verified local executable, run:

```sh
pnpm install --offline --frozen-lockfile --ignore-scripts \
  --config.enableGlobalVirtualStore=false --virtual-store-dir=node_modules/.pnpm
```

Here `pnpm` means the already-inspected local 12.21.0 executable, not an unverified shim. The command may write only the worktree-owned dependency layout and package-manager metadata associated with the offline restore. A reinstall to repair that local layout is also covered after the same checks. Supply the virtual-store settings as command options; do not persist them in tracked or global configuration. Do not delete, unlink, or rewrite shared trees to make an installation qualify.

pnpm 12 verifies the lockfile against supply-chain policies before linking, which needs registry metadata in its own `v12` metadata cache (a pnpm 11 `v11` metadata cache does not satisfy it). If an offline restore fails with `ERR_PNPM_NO_OFFLINE_META`, stop and request approval for a network-enabled metadata fetch; tarballs already in the content-addressable store are still reused. The first document in `pnpm-lock.yaml` pins pnpm itself (`packageManagerDependencies`); it is maintained by pnpm and is not a dependency change.

Outside this bounded case, obtain explicit approval before installing. Network/cache population, new dependencies or versions, required install scripts, binary downloads, and toolchain provisioning still need separate approval. Do not drop `--offline`, relax `--frozen-lockfile`, or enable lifecycle scripts as a fallback. Normal project build and test commands within the approved task are separate from dependency installation hooks.

This exception covers the explicit restore command, not implicit installation through `pnpm run` or `pnpm exec`. Use command-local `verifyDepsBeforeRun=error` and matching virtual-store settings for those commands so a layout mismatch fails instead of triggering an implicit install. Standing authorization does not bypass sandbox or tool approvals and does not authorize CI edits, profile application, commits, or deployment.

The policy applies to worktrees that contain these instructions. It does not update older branches or authorize installs in other repositories. Existing workers on older instructions need updated guidance or direct user authorization.

The `0.2.2-rc.5` offline frozen, scripts-disabled install was validated in the checkout-owned Linux ARM64 dependency tree with a populated pnpm 11 cache, after explicitly approved network cache population. This does not establish fresh-cache or other-platform install success. See the [current migration handoff](../../../MIGRATION-0.2.2-rc.5.md) for actual target-version results and limitations. Fresh setup fixtures validate dependency-free checks and ownership observations, not cache population.

## Choose validation commands

The following command definitions are verified against repository files. Execution status is separate; record exact commands and outcomes in each change report.

| Command from repository root                              | Prerequisites and effects                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/check.mjs`                                  | Supported Node.js only; reads manifests, recipe sources, and bundle patch existence. Does not validate a full Cordis mount.                                                                                                                                                |
| `git diff --check`                                        | Git checkout; checks tracked diff whitespace, not behavior or all untracked files.                                                                                                                                                                                         |
| `pnpm run format:check`                                   | Verified pnpm executable and installed pinned Prettier; checks maintained files without writes. Honors `.prettierignore`; not a type or behavior check.                                                                                                                    |
| `pnpm run format`                                         | Same formatter prerequisites; rewrites maintained files across the repository. Use `node node_modules/prettier/bin/prettier.cjs --write <paths>` for focused changes; `pnpm exec` can synchronize dependencies implicitly. Rebuild affected generated artifacts afterward. |
| `node --test packages/dsh-project-steward/test/*.test.js` | Existing pinned root DSH development dependency; no build. Uses temporary fixtures and real dormant Cordis services; no live GUI, model call, or install.                                                                                                                  |
| `pnpm run build`                                          | Verified pnpm executable plus workspace dev dependencies; writes Session Environment build artifacts. Its scripts invoke pnpm internally, so ensure nested resolution also uses the verified executable.                                                                   |
| `pnpm test`                                               | Same prerequisites as build; `pretest` builds Session Environment before all root-listed Node tests. Not covered by running only Steward tests.                                                                                                                            |
| `pnpm run test:browser`                                   | Built dependencies and compatible Chromium; runs Vitest/Playwright interactions. Missing browsers require separately approved provisioning.                                                                                                                                |
| `pnpm run test:visual`                                    | Built bundles, compatible browser/container, and the README's Linux ARM64 baseline environment. Starts a disposable DSH host; writes test artifacts. Do not run against a live profile.                                                                                    |
| `node scripts/apply-profile.mjs personal-web --dry-run`   | Node.js and readable recipe/profile patch; prints intended actions without invoking DSH or writing a profile. A pre-existing nonempty patch can cause refusal. Actual apply installs bundles and writes runtime configuration; it requires separate approval.              |

For full browser/container prerequisites and artifact locations, read `README.md`. Do not update snapshots, download browsers, start a GUI server, or apply/restart a profile as an automatic validation fallback. Distinguish unsupported platform, missing executable/cache, missing built artifacts, and permission failures from test failures.

## DSH 0.2.2-rc.5 compatibility and profile safety

- Both the launcher runtime and standalone profile graph require the exact `@deepseek-ai/dsh-client-connection@0.2.2-rc.5` RPC-owner patch in `patches/dsh-client-connection-0.2.2-rc.5-rpc-owner.patch`. The real-artifact ownership regression fails without the `getTraceable(this.ctx, this.ctx)` fix. pnpm 11 reads `patchedDependencies` from `pnpm-workspace.yaml`, not the legacy `package.json` field. Keep the patch file and lock hash together; never edit installed package files or shared store inodes.
- The approved `apply` command defaults to and supports only this checkout's `node_modules/.bin/dsh`. Before profile writes it verifies the launcher version and patched implementation, resolves every recipe source, and refuses a nonempty profile patch unless explicitly overridden. An unrelated/global launcher fails closed and is never modified. Actual apply lazily loads the pinned YAML parser; dry-run remains dependency-free.
- Apply copies the required core patch into the target profile, preserves existing YAML settings with a backup, snapshots local sources, adds the complete graph offline/scripts-disabled, then runs a frozen install and verifies the profile's own patched Web/Connection resolution. Conflicting core patches and symlinked target paths are refused. Installs are not transactional: after failure inspect the target before retrying. Existing dependency-directory ownership must still be checked manually; symlink detection does not establish bind-mount or hardlink ownership.
- Validate with `NODE_PATH` unset to prevent Harness dependencies masking missing modules. On macOS use a canonical temporary directory, e.g. `env -u NODE_PATH TMPDIR=/private/tmp pnpm test`, to avoid `/var` versus `/private/var` assertions. Read the [migration handoff](../../../MIGRATION-0.2.2-rc.5.md) before applying to retained profiles/histories. Force Session Environment's host/browser TypeScript builds so stale incremental artifacts cannot mask changed upstream declarations. No restart or live deployment is implied by tests or a config dump; real Loader and authenticated RPC checks are separate evidence.

## Keep guidance accurate

When scripts, CI, package pins, or recipe order change, compare this procedure with those sources. Keep `AGENTS.md` short and load this skill conditionally. Report stale guidance and propose a scoped correction; do not silently rewrite CI to match documentation. Record actual test counts, prerequisites, and skipped checks rather than claiming that a command definition proves success.
