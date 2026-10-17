# DSH 0.2.1-rc.1 migration handoff

> **Status: in progress.** This handoff records the migration as it stands on its draft pull request. The remaining blockers below must be resolved before it is complete.

This repository targets **DSH `0.2.1-rc.1` only**. Upgrade the runtime and plugin graph together. This handoff does not authorize profile application, deployment, restart, or retained-state conversion.

The official target is [`dsh-v0.2.1-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.1), commit `1600d8a1e140dcde43a1a0941940a0480712c011`.

The [0.2.0-rc.2 handoff](MIGRATION-0.2.0-rc.2.md) remains an unchanged historical record.

## Migration scope

- All bundles and the root development graph pin DSH `0.2.1-rc.1` exactly, including the `@deepseek-ai/dsh` runtime-admission peer. Each bundle receives a patch-version increment.
- Upstream moves Cordis to `4.0.5`, Schemastery to `3.18.5` and `cordis-plugin-group` to `1.0.5`; local exact pins follow.
- Upstream no longer publishes `@deepseek-ai/dsh-invariants` at the target. Session Environment drops it and instead declares `@deepseek-ai/dsh-client-store` and `@deepseek-ai/dsh-client-ui-slots` as type-only development dependencies, because the target's Session and Layout declarations import them without declaring them.
- `dsh-session-persistence-jsonl` is now a module-style plugin without a default export. Test fixtures pass the module itself to `ctx.plugin`.

## Required RPC-owner patch

The published `@deepseek-ai/dsh-client-connection@0.2.1-rc.1` artifact still reads `const owner = this.ctx` in its `rpc` getter. The [target-version RPC-owner patch](patches/dsh-client-connection-0.2.1-rc.1-rpc-owner.patch) carries the same `getTraceable(this.ctx, this.ctx)` payload, regenerated for the target line offsets. Carry it in each independent launcher and profile dependency graph, exactly as for 0.2.0-rc.2.

## Release-age exceptions

The global `minimumReleaseAge: 5760` stays. The exact-version exception list covers every locked DSH package at the target and, separately labelled, the exact Cordis-family and pi-ai versions that the target requires and that were published alongside it (`cordis@4.0.5`, `cordis-plugin-{group,include,loader,timer}`, `cosmokit@1.8.6`, `schemastery@3.18.5`, `@earendil-works/pi-ai@1.3.0`, `@earendil-works/pi-telemetry@1.3.0`). Remove those exceptions once the versions satisfy the delay.

## Open blockers

- **Worktree workers.** Upstream removes new one-shot subagent runs; `SubagentRuntime.start`, `settleRun`, `localAgent`, `toolFilter` and the `one-shot` descriptor mode are gone. The Worktree host no longer type-checks and its worker, manager, job and real-mount suites fail. Porting requires moving workers onto the continuable subagent provider model.
- **Codex Fast bridge.** Upstream upgrades pi-ai from `0.87.1` to `1.3.0`. The bridge verifies the exact pi-ai version and fails closed, so every Fast path reports the integration as incompatible. Re-enabling it requires re-auditing the private hooks the bridge wraps against pi-ai 1.3.0. Composition tests also need the new `webStartup` service.
- **Fixture services.** Real-Loader preset fixtures (File Intuition, Global Guidance, Product Mode, Project Steward, Worktree preset) now wait for a `workingDirectory` service, and the target Standard preset baseline changed. Session Recap's profile fixture fails on `browserAuth.authenticateApi`.

## Validation results

Linux ARM64, Node `22.22.0`, pnpm `11.9.0`, `NODE_PATH` unset.

| Check                                                                 | Result                                                                                              |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Network install with release-age exceptions; frozen offline reinstall | Passed                                                                                              |
| `pnpm run build` (Session Environment host and client)                | Passed                                                                                              |
| `node scripts/check.mjs`                                              | Passed: one profile recipe and 37 package references                                                |
| Full Node suite, `env -u NODE_PATH pnpm test`                         | Failing; see open blockers. 10 Worktree Git tests also fail on unchanged `main` in this environment |
