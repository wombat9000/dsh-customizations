# DSH 0.2.1-rc.3 migration handoff

This repository targets **DSH `0.2.1-rc.3` only**. Upgrade the runtime and plugin graph together. This handoff does not authorize profile application, deployment, restart, or retained-state conversion.

The official target is [`dsh-v0.2.1-rc.3`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.3), commit `1f81c047fc48fa190a683e469daa699857e9afe8`.

The [0.2.1-rc.2 handoff](MIGRATION-0.2.1-rc.2.md) and [0.2.1-rc.1 handoff](MIGRATION-0.2.1-rc.1.md) remain unchanged historical records; the rc.1 handoff still describes the larger 0.2.0-rc.2 to 0.2.1 migration (Worktree activations, preset re-sync, pi-ai 1.3.0).

## Migration scope

- All bundles and the root development graph pin DSH `0.2.1-rc.3` exactly, including the `@deepseek-ai/dsh` runtime-admission peer. Each bundle receives a patch-version increment.
- The Cordis family, Schemastery and pi-ai versions are unchanged from rc.2.
- Upstream adds `@deepseek-ai/dsh-client-ui-entry-customization` (sidebar and conversation-view plugin entry customization, pulled in by `dsh-web-app`). No package was removed.

## Required RPC-owner patch

The published `@deepseek-ai/dsh-client-connection@0.2.1-rc.3` artifact still reads `const owner = this.ctx` in its `rpc` getter. The [target-version RPC-owner patch](patches/dsh-client-connection-0.2.1-rc.3-rpc-owner.patch) is the rc.2 patch renamed; its content applies unchanged. Carry it in each independent launcher and profile dependency graph, exactly as before.

## Release-age exceptions

The global `minimumReleaseAge: 5760` stays. The exact-version exception list covers every locked DSH package at the target. The Cordis-family and pi-ai exceptions from rc.1 and rc.2 are gone, because those versions now satisfy the delay.

## Codex Fast bridge

`@deepseek-ai/dsh-llm-pi-ai@0.2.1-rc.3` ships the same files as rc.2. The bridge therefore accepts the rc.3 adapter version with pi-ai `1.3.0` exactly, with no hook changes.

## Host operator acceptance sequence

The sequence in the [0.2.0-rc.2 handoff](MIGRATION-0.2.0-rc.2.md) still applies: back up retained state, apply the profile only with explicit approval, and restart through the usual service mechanism after selecting the verified checkout-local launcher.

## Validation results

Linux x86-64 cloud container, pnpm `11.9.0`.

| Check                                                  | Result                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Network install with release-age exceptions            | Passed                                                                                                                    |
| `pnpm run build` (Session Environment host and client) | Passed                                                                                                                    |
| Worktree and Codex Compat typecheck and build          | Passed; rebuilt `dist` matches the committed output                                                                       |
| `node scripts/check.mjs`                               | Passed: one profile recipe and 37 package references                                                                      |
| Full Node suite, `pnpm test`                           | 1607 passed, 17 failed; all failures are Worktree Git tests that fail identically on unchanged `main` in this environment |
| Browser and visual suites                              | Not run locally (no matching Playwright browser); left to CI                                                              |
