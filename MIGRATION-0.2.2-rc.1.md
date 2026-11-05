# DSH 0.2.2-rc.1 migration handoff

This repository targets **DSH `0.2.2-rc.1` only**. Upgrade the runtime and plugin graph together. This handoff does not authorize profile application, deployment, restart, or retained-state conversion.

The official target is [`dsh-v0.2.2-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1), commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`.

The [0.2.1-rc.5](MIGRATION-0.2.1-rc.5.md) and earlier handoffs remain unchanged historical records.

## Migration scope

- All bundles and the root development graph pin DSH `0.2.2-rc.1` exactly, including the `@deepseek-ai/dsh` runtime-admission peer. Each bundle receives a patch-version increment.
- Upstream moves Cordis to `4.1.0`, Schemastery to `3.19.0`, `cordis-plugin-{include,loader}` to `1.1.0`, `cordis-plugin-timer` to `1.2.0` and `cosmokit` to `1.9.0`. Local exact pins follow, and the root `cordis-plugin-group` pin moves to `1.1.0`, the first release whose peers accept Cordis 4.1.
- pi-ai stays at `1.3.0`.
- Upstream adds the tool executors (`dsh-tool-executor-native`, `dsh-tool-executor-ptc`), action cards, creation and plugin recommendations, file actions, message quotes, `dsh-fs-patch`, `dsh-official-bundles` and several experimental Forge and Liveshare packages. It no longer publishes `@deepseek-ai/dsh-client-ui-deepseek-model-label-1017`. No local bundle referenced it.

## Tool executors

`ctx.tools.execute()` now delegates a complete batch of raw model calls (`{ calls, signal, agent? }`) to the executor selected for the scope, and returns `{ results, additionalContexts, concluded }`. The base bundle mounts `tool-executor-native` (and a disabled `tool-executor-ptc`), so profiles need no change. No production bundle calls `tools.execute()` directly.

Test fixtures that compose `tools` by hand now also mount `@deepseek-ai/dsh-tool-executor-native`. The shared GitHub approval fixture exports `executeOne()`, which runs one call as a single-call batch and returns its settled result. The YouTube test reads `renderToolsSdk` from `dsh-tool-executor-ptc`, its new home.

## Projections, approval and titles

User Approval keeps its policy and open-turn state in a session projection, so fixtures that mount it also mount `@deepseek-ai/dsh-session-projection`. The preset registry and Session Title service now inject the Agent registry, so the reduced preset host and the V4 history test mount `@deepseek-ai/dsh-agent` (no Agent is created). A prepared Session stays read-only until the store enters and announces it; the history test does both before appending live turns.

## Codex Fast

`sessionProjections.stateOf(session, key)` is deprecated and untyped. Fast now reads the session's selection from the Agent's own model (`agent.model.current()`), falling back to the default model, and no longer injects `sessionProjections`. The client imports `@deepseek-ai/dsh-agent` types, which now declare the `modelSelection` projection key.

`@deepseek-ai/dsh-llm-pi-ai@0.2.2-rc.1` adds mid-conversation effort handling, image-count limits and larger default context and output budgets. The adapter methods the bridge wraps (`current`, `modelOf`, `streamWithSnapshot`, `streamSimple`) are unchanged, so the bridge accepts the 0.2.2-rc.1 adapter with pi-ai `1.3.0` exactly.

## Loader 1.1

`EntryTree` subclasses persist changes through `commit(change)` instead of `write()`, and `fiber.config` is now the raw input; the effective config with live references is `fiber.effectiveConfig`. The preset fixture's in-memory tree and the Session Recap Loader test follow.

## Standard preset re-sync

The target Standard preset sets `applyPatch: false` on `tool-fs`, drops `tool-subagent-list-agents`, replaces `modelSelectionSettings` with `modelSelection` and `modelDiscovery`, and enables `tool-plugin-manager` only when a profile context exists. The Product mode and Project Steward presets follow and keep their Ralph row.

## Required RPC-owner patch

The published `@deepseek-ai/dsh-client-connection@0.2.2-rc.1` artifact still reads `const owner = this.ctx` in its `rpc` getter. The [target-version RPC-owner patch](patches/dsh-client-connection-0.2.2-rc.1-rpc-owner.patch) is the rc.5 patch renamed; its content applies unchanged.

## Release-age exceptions

The global `minimumReleaseAge: 5760` stays. The exact-version exception list covers every locked DSH package at the target and, separately labelled, the Cordis-family versions published with it (`cordis@4.1.0`, `cordis-plugin-{group,include,loader}@1.1.0`, `cordis-plugin-timer@1.2.0`, `cosmokit@1.9.0`, `schemastery@3.19.0`). Remove those exceptions once the versions satisfy the delay.

## Host operator acceptance sequence

The sequence in the [0.2.0-rc.2 handoff](MIGRATION-0.2.0-rc.2.md) still applies: back up retained state, apply the profile only with explicit approval, and restart through the usual service mechanism after selecting the verified checkout-local launcher.

## Validation results

Linux x86-64 cloud container, pnpm `11.9.0`.

| Check                                       | Result                                                       |
| ------------------------------------------- | ------------------------------------------------------------ |
| Network install with release-age exceptions | Passed; `pnpm peers check` reports no issues                 |
| Every bundle's `build` script               | Passed; only Codex Compat `dist` changed                     |
| `node scripts/check.mjs`                    | Passed: one profile recipe and 41 package references         |
| Full Node suite, `pnpm test`                | 1620 passed, 0 failed                                        |
| Browser and visual suites                   | Not run locally (no matching Playwright browser); left to CI |
