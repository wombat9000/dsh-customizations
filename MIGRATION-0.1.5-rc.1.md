# DSH 0.1.5-rc.1 compatibility migration

This is a source/dependency compatibility update, not a deployment. Existing DSH installations, runtime state and sandboxes are not upgraded by pulling this branch.

## Compatibility changes

- Worktree passes `parentAgent: parent`, uses `setup(ctx, agent)` and appends the native descriptor to the unpublished child instead of calling removed `seedDescriptorTurn`.
- Worktree and Steward use persona `prefix`/`suffix` and retain the target Standard `present` tool.
- Google Drive no longer ships an agent preset or contributes a roster root. Google Auth, Drive host/client integration, the default-off toolbar toggle and permission-gated tools remain available with other presets.
- Declared DSH dependencies target `0.1.5-rc.1`; shared Cordis contracts are aligned and React/React DOM remain `18.3.1`. The regenerated lock removes old prerelease peers. Workspace release-age exceptions remain exact package/version entries, not a global policy bypass.
- Recap declares `webServer`; Worktree waits for both optional `connection` and `webServer` before registering RPCs. Real traced-Service registration/disposal tests replace reliance on raw-object mocks.
- Synthetic persistence fixtures use target session handles and v3 storage. Tests never rewrite user histories.

## Required core RPC-owner patch

The target Connection `rpc` getter captures a temporarily provider-shadowed Cordis context. Caller injection declarations alone do not fix ownership. [The pinned patch](patches/dsh-client-connection-0.1.5-rc.1-rpc-owner.patch) imports public Cordis `getTraceable` and captures `getTraceable(this.ctx, this.ctx)`. Synchronous registration and caller-owned cleanup remain unchanged; authentication and permissions are not bypassed.

The patch is exact-version scoped in `pnpm-workspace.yaml` and hashed in `pnpm-lock.yaml`. Frozen installs reproduce it without manual `node_modules` edits. It is required in **both** the launcher and standalone profile dependency graphs. Do not substitute an `owner.inject` workaround: it previously allowed shell startup but left custom routes absent. Patch SHA256: `375a4273536fe2b2e434e14f622052592a43e42f0496e47fffe8768887519fce`.

## Migration procedure

1. Read the [setup skill](.agents/skills/repository-setup/SKILL.md), establish checkout/dependency ownership, exact pnpm availability and cache readiness, and obtain installation/profile-change approval. Use a durable checkout path. Back up retained profiles and histories before a separately approved runtime migration; do not copy credentials into this repository.
2. Install the committed graph with `pnpm install --offline --frozen-lockfile --ignore-scripts`, then run `pnpm run check`, `pnpm run build` and `pnpm test`. Stop on cache misses; network provisioning needs separate approval.
3. Inspect existing preset IDs, saved selections and the full roster. The recipe retains Worktree and Steward roots; bundle/profile overlays replace complete roster configuration, so preserve other custom roots, defaults and discovery settings in your reviewed target override. Saved sessions naming the removed Google Drive preset need explicit review; do not silently rewrite selections or delete histories. Historical session formats unsupported by target DSH require a separately approved copied-data migration/archival plan.
4. Preview `pnpm run apply -- personal-web --dry-run`. Dry-run performs no launcher execution, dependency installation or writes; it is not compatibility proof.
5. After approval, `pnpm run apply -- personal-web` uses only this checkout's patched launcher. It refuses unsupported/global launchers before writes, configures the required patch in the profile YAML, copies the patch into that profile, snapshots local bundles, pins recipe DSH bundles and target DSH transitive overrides to the validated version, merges only exact release-age exceptions, and adds the entire selected graph offline with scripts disabled. It verifies a frozen install and the profile's own patched Web/Connection implementation before dumping config. Existing unrelated YAML settings are preserved with a backup; conflicting patches and symlinked targets fail closed. A nonempty Cordis patch requires review and `--force-patch` (backs it up); never use that flag to discard unreviewed custom configuration. Existing bundles absent from the recipe are not automatically removed, and existing bundle order is retained by DSH.
6. Application is not transactional. If dependency resolution fails, no ready message is printed; inspect partial profile changes and restore reviewed backups as needed before retrying. A symlink check cannot prove bind-mount or hardlink ownership. Provision an incomplete offline cache only after separate approval.
7. Start or restart via the user's normal service mechanism with `./node_modules/.bin/dsh --profile personal-web`, then refresh the browser. No automatic restart or global DSH update occurs. For an independently managed launcher, its owner must carry this patch in that runtime graph and validate it independently; this script intentionally refuses other launchers.
8. Verify actual Loader boot and authenticated Recap/Worktree RPCs, not just shell HTTP readiness or `--dump-config`. Fresh provider operations, browser interactions and retained-history migration are distinct checks.

## Validation and limits

PR-worktree validation on macOS ARM64: the full build and Node suite passed with 650 tests (642 passed, eight skipped). Seven skips require native PDF prerequisites and one is Linux-specific descendant cleanup. The portable browser-free smoke also passed real multi-plugin Loader boot, durable fixture read-back, token exchange and authenticated Recap/Worktree RPCs. These checks do not claim a live deployment or new visual baselines.

This branch adds reproducible frozen patched installs and six passing profile-application regressions, including no-write unsupported/unpatched-launcher rejection and preservation of existing profile YAML. An actual application to a new disposable home also passed: all nine recipe bundles installed offline with zero downloads, followed by a frozen scripts-disabled install, the profile's own patched Web/Connection verification, and `--dump-config`. That check did not start a Web server or modify a live profile. Run the committed tests for current counts; the preparation report is not a replacement for PR validation. Browser baselines are platform-specific and require the README's pinned Linux ARM64 environment. No live provider operation, GUI restart, sandbox deployment or existing-history modification is performed by this patch.

Browser/visual verification remains pending: the local Playwright Chromium executable is not cached and the Docker daemon is unavailable. No browser downloads, CI changes, or PNG baseline updates were made. Revalidate the existing Linux ARM64 baselines against the new DSH layout before merging; a passing browser-free smoke does not prove screenshot compatibility.

Reusable lessons: independently pin both dependency layers, use real Cordis ownership and route-disposal tests, distinguish authenticated custom RPC success from shell readiness, and unset inherited `NODE_PATH` during isolated tests. On macOS use canonical `TMPDIR=/private/tmp` for filesystem assertions.
