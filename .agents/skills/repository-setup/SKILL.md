---
name: repository-setup
description: Check dependency ownership and pinned tools, prepare an approved offline install, and choose validation commands for this repository in a fresh checkout or worktree.
---

# Repository setup

Use this procedure before dependency work or validation. It is repo-owned Markdown and works without Project Steward or a skill loader. Run commands from the repository root unless stated otherwise. Setup is not automatic, and permission to edit code is not permission to install dependencies.

## Verified repository facts

These facts come from repository configuration, not an install result:

- `package.json` pins `pnpm@11.9.0` and supports Node.js `^22.19.0 || >=24.0.0` (not Node.js 23).
- `pnpm-workspace.yaml` includes `packages/*`; `pnpm-lock.yaml` records the dependency graph. Local bundles live in `packages/`; `profiles/personal-web/recipe.json` selects them through portable relative paths.
- Root `check` runs the dependency-free `node scripts/check.mjs`. Root `test` has a `pretest` hook that runs `build`; build invokes the Session Environment workspace's TypeScript/tsdown host and client builds and writes generated artifacts. Bypassing `pretest` is suitable for scoped tests that do not need those artifacts, not an equivalent full test run.
- `.github/workflows/tests.yml` uses Node.js 24.20.0 and pnpm 11.9.0 in a pinned Linux ARM64 Playwright container. Its existing install allows network access and disables lifecycle scripts. It runs checks, unit tests, browser interactions, and visual comparisons. The local offline-first procedure below does not change CI.

## Check safe prerequisites

1. Confirm the checkout with `pwd`, `git status --short`, and `node --version`. Preserve unrelated changes. A new worktree shares Git metadata but does not bring its own `node_modules` from the source checkout.
2. Locate pnpm with `command -v pnpm` on POSIX (or `Get-Command pnpm` on PowerShell), without invoking it. Inspect the executable's symlink target, wrapper, and adjacent package manifest. Establish that the exact 11.9.0 executable and its runtime files are already available. Even `pnpm --version` can trigger provisioning through a shim or version manager. If the pin is unavailable, stop and request approval for provisioning. Do not run `npx`, Corepack preparation, or a package-manager downloader automatically.
3. Inspect root `node_modules` and each `packages/*/node_modules` using lstat/readlink/realpath or equivalent. Inspect parent path components, bind mounts, and `.npmrc`/workspace virtual-store settings too. If any dependency directory is symlinked, shared with another checkout, or has uncertain ownership, **do not install there**. Do not unlink, delete, relink, or mutate another checkout's dependencies automatically. Normal package links inside a checkout-owned pnpm tree are expected; a link to another checkout's whole tree is different. A shared content-addressed cache is not a shared dependency tree.
4. Inspect package-manager configuration, environment overrides, registry settings, and the chosen cache location without printing credentials. Require an accessible cache with the locked packages for this OS/architecture. Directory existence does not establish cache completeness. If the cache is missing or incomplete, stop and report the limitation. Do not fall back online automatically.

A dependency link explicitly authorized for read-only testing is not authorization to install, build into its target, or modify the parent checkout. Report borrowed dependencies as a validation limitation. Recheck ownership in every fresh checkout/worktree.

## Install only after approval

Once the exact executable, owned dependency directories, configuration, and cache prerequisites are established, obtain explicit approval for an install in this checkout. Using the verified local executable, run:

```sh
pnpm install --offline --frozen-lockfile --ignore-scripts
```

Here `pnpm` means the already-inspected local 11.9.0 executable, not an unverified shim. The command writes the checkout's dependency tree and package-manager metadata. It must not update the lockfile. If offline resolution fails, stop and report the error. Do not remove `--offline`, relax `--frozen-lockfile`, upgrade dependencies, or enable lifecycle scripts automatically. Obtain separate approval for cache population/network access and any necessary lifecycle script or binary download.

**Execution gap:** this procedure's fresh offline frozen install has not been executed as part of Project Steward v1. Tests use the existing pinned dependency graph. Fresh fixtures validate dependency-free checks and absence/ownership observations, not cache completeness or install success.

## Choose validation commands

The following command definitions are verified against repository files. Execution status is separate; record exact commands and outcomes in each change report.

| Command from repository root | Prerequisites and effects |
| --- | --- |
| `node scripts/check.mjs` | Supported Node.js only; reads manifests, recipe sources, and bundle patch existence. Does not validate a full Cordis mount. |
| `git diff --check` | Git checkout; checks tracked diff whitespace, not behavior or all untracked files. |
| `node --test packages/dsh-project-steward/test/*.test.js` | Existing pinned root DSH development dependency; no build. Uses temporary fixtures and real dormant Cordis services; no live GUI, model call, or install. |
| `node --test packages/dsh-worktree/test/*.test.js` | Existing root and Worktree package dependencies; no bundle build. Uses temporary Git repositories, processes, and dormant host fixtures. |
| `pnpm run build` | Verified pnpm executable plus workspace dev dependencies; writes Session Environment build artifacts. Its scripts invoke pnpm internally, so ensure nested resolution also uses the verified executable. |
| `pnpm test` | Same prerequisites as build; `pretest` builds Session Environment before all root-listed Node tests. Not covered by running only Steward tests. |
| `pnpm run test:browser` | Built dependencies and compatible Chromium; runs Vitest/Playwright interactions. Missing browsers require separately approved provisioning. |
| `pnpm run test:visual` | Built bundles, compatible browser/container, and the README's Linux ARM64 baseline environment. Starts a disposable DSH host; writes test artifacts. Do not run against a live profile. |
| `node scripts/apply-profile.mjs personal-web --dry-run` | Node.js and readable recipe/profile patch; prints intended actions without invoking DSH or writing a profile. A pre-existing nonempty patch can cause refusal. Actual apply installs bundles and writes runtime configuration; it requires separate approval. |

For full browser/container prerequisites and artifact locations, read `README.md`. Do not update snapshots, download browsers, start a GUI server, or apply/restart a profile as an automatic validation fallback. Distinguish unsupported platform, missing executable/cache, missing built artifacts, and permission failures from test failures.

## Keep guidance accurate

When scripts, CI, package pins, or recipe order change, compare this procedure with those sources. Keep `AGENTS.md` short and load this skill conditionally. Report stale guidance and propose a scoped correction; do not silently rewrite CI to match documentation. Record actual test counts, prerequisites, and skipped checks rather than claiming that a command definition proves success.
