# DSH 0.2.1-rc.4 migration handoff

This repository targets **DSH `0.2.1-rc.4` only**. Upgrade the runtime and plugin graph together. This handoff does not authorize profile application, deployment, restart, or retained-state conversion.

The official target is [`dsh-v0.2.1-rc.4`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.4), commit `504a01a9578abc2c6f1fb896b1dc322c9fe24f66`.

The [0.2.1-rc.3](MIGRATION-0.2.1-rc.3.md), [0.2.1-rc.2](MIGRATION-0.2.1-rc.2.md) and [0.2.1-rc.1](MIGRATION-0.2.1-rc.1.md) handoffs remain unchanged historical records; the rc.1 handoff still describes the larger 0.2.0-rc.2 to 0.2.1 migration (Worktree activations, preset re-sync, pi-ai 1.3.0).

## Migration scope

- All bundles and the root development graph pin DSH `0.2.1-rc.4` exactly, including the `@deepseek-ai/dsh` runtime-admission peer. Each bundle receives a patch-version increment.
- The Cordis family, Schemastery and pi-ai versions are unchanged from rc.3.
- No upstream package was added or removed.

## Required RPC-owner patch

The published `@deepseek-ai/dsh-client-connection@0.2.1-rc.4` artifact still reads `const owner = this.ctx` in its `rpc` getter. The [target-version RPC-owner patch](patches/dsh-client-connection-0.2.1-rc.4-rpc-owner.patch) is the rc.3 patch renamed; its content applies unchanged. Carry it in each independent launcher and profile dependency graph, exactly as before.

## Release-age exceptions

The global `minimumReleaseAge: 5760` stays. The exact-version exception list covers every locked DSH package at the target. No Cordis-family or pi-ai exception is needed.

## Codex Fast bridge

`@deepseek-ai/dsh-llm-pi-ai@0.2.1-rc.4` ships the same files as rc.3, as do `dsh-base` and `dsh-client-connection`. The bridge therefore accepts the rc.4 adapter version with pi-ai `1.3.0` exactly, with no hook changes.

## Host operator acceptance sequence

The sequence in the [0.2.0-rc.2 handoff](MIGRATION-0.2.0-rc.2.md) still applies: back up retained state, apply the profile only with explicit approval, and restart through the usual service mechanism after selecting the verified checkout-local launcher.

## Validation results

Linux x86-64 cloud container, pnpm `11.9.0`.

| Check                                                  | Result                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| Network install with release-age exceptions            | Passed                                                       |
| `pnpm run build` (Session Environment host and client) | Passed                                                       |
| Codex Compat typecheck and build                       | Passed; rebuilt `dist` matches the committed output          |
| `node scripts/check.mjs`                               | Passed: one profile recipe and 41 package references         |
| Full Node suite, `pnpm test`                           | 1619 passed, 0 failed                                        |
| Browser and visual suites                              | Not run locally (no matching Playwright browser); left to CI |
