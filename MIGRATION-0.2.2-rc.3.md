# DSH 0.2.2-rc.3 migration handoff

This repository targets **DSH `0.2.2-rc.3` only**. Upgrade the runtime and plugin graph together. This handoff does not authorize profile application, deployment, restart, or retained-state conversion.

The official target is [`dsh-v0.2.2-rc.3`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.3), commit `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`.

The [0.2.2-rc.2](MIGRATION-0.2.2-rc.2.md) and earlier handoffs remain unchanged historical records; the rc.2 handoff still describes the Agent registry removals and the Standard preset re-sync.

## Migration scope

- All bundles and the root development graph pin DSH `0.2.2-rc.3` exactly, including the `@deepseek-ai/dsh` runtime-admission peer. Each bundle receives a patch-version increment.
- Cordis, Schemastery, pi-ai and Codex Compatibility's zod are unchanged from rc.2.
- Upstream adds the experimental `dsh-deepseek-chat-import` package and a New Session row slot in the sidebar. No package was removed, and the Standard preset is unchanged, so the custom presets need no re-sync.

## Required RPC-owner patch

The published `@deepseek-ai/dsh-client-connection@0.2.2-rc.3` artifact still reads `const owner = this.ctx` in its `rpc` getter. The [target-version RPC-owner patch](patches/dsh-client-connection-0.2.2-rc.3-rpc-owner.patch) is the rc.2 patch renamed; its content applies unchanged.

## Release-age exceptions

The global `minimumReleaseAge: 5760` stays. The exact-version exception list covers every locked DSH package at the target. No Cordis-family or pi-ai exception is needed.

## Codex Fast bridge

`@deepseek-ai/dsh-llm-pi-ai@0.2.2-rc.3` ships the same files as rc.2, as do `dsh-base` and `dsh-client-connection`. The bridge therefore accepts the rc.3 adapter version with pi-ai `1.3.0` exactly, with no hook changes. The Agent registry surface that Subagents Fast, GitHub grants and Google Drive use is also unchanged.

## Host operator acceptance sequence

The sequence in the [0.2.0-rc.2 handoff](MIGRATION-0.2.0-rc.2.md) still applies: back up retained state, apply the profile only with explicit approval, and restart through the usual service mechanism after selecting the verified checkout-local launcher.

## Validation results

Linux x86-64 cloud container, pnpm `11.9.0`.

| Check                                       | Result                                                          |
| ------------------------------------------- | --------------------------------------------------------------- |
| Network install with release-age exceptions | Passed; `pnpm peers check` reports no issues                    |
| Every bundle's `build` script               | Passed; only version strings changed in Codex and GitHub `dist` |
| `node scripts/check.mjs`                    | Passed: one profile recipe and 41 package references            |
| Full Node suite, `pnpm test`                | 1619 passed, 0 failed, 7 skipped                                |
| Browser and visual suites                   | Not run locally (no matching Playwright browser); left to CI    |
