# DSH 0.2.2-rc.2 migration handoff

This repository targets **DSH `0.2.2-rc.2` only**. Upgrade the runtime and plugin graph together. This handoff does not authorize profile application, deployment, restart, or retained-state conversion.

The official target is [`dsh-v0.2.2-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.2), commit `ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`.

The [0.2.2-rc.1](MIGRATION-0.2.2-rc.1.md) and earlier handoffs remain unchanged historical records.

## Migration scope

- All bundles and the root development graph pin DSH `0.2.2-rc.2` exactly, including the `@deepseek-ai/dsh` runtime-admission peer. Each bundle receives a patch-version increment.
- Cordis `4.1.0`, Schemastery `3.19.0`, the Cordis plugin family and pi-ai `1.3.0` are unchanged from rc.1.
- Upstream adds `@deepseek-ai/dsh-cua-bundle`, Agent Teams (`dsh-agent-team`, `dsh-tool-agent-team`) and `dsh-tool-office`, renames `dsh-deepseek-account-platform` to `dsh-deepseek-account`, and no longer publishes `dsh-experimental-agent-team-profile`. No local bundle referenced the removed or renamed packages.

## Codex Fast

- `@deepseek-ai/dsh-storage-domain` now builds on zod `4.6.6`. Codex Compatibility's runtime `zod` dependency moves from `4.4.3` to `4.6.6` so its domain schemas type-check against the storage contract. Downstream staging that reviews Codex's runtime dependencies must accept the new version.
- `AgentRegistry.isOwnedBy()` and runtime parent ownership were removed upstream. Subagents Fast now requires native subagent metadata, a consistent delegation depth and the exact live parent Agent for every edge, and still rechecks those identities before a pending payload is sent. A resumed child whose live parent is the opted-in root therefore qualifies; it previously stayed Standard. The ownership-specific tests are removed.

## Standard preset re-sync

The target Standard preset gives `skill-filesystem` the agent-preset `skills` directory as a custom skill root, sets `interrupt: false` on `tool-subagent-control`, and adds `tool-office` after `present`. The Product mode and Project Steward presets follow and keep their Ralph row. They do not add Agent Teams, which upstream mounts from the base bundle rather than the Standard preset.

## Required RPC-owner patch

The published `@deepseek-ai/dsh-client-connection@0.2.2-rc.2` artifact still reads `const owner = this.ctx` in its `rpc` getter. The [target-version RPC-owner patch](patches/dsh-client-connection-0.2.2-rc.2-rpc-owner.patch) is the rc.1 patch renamed; its content applies unchanged.

## Release-age exceptions

The global `minimumReleaseAge: 5760` stays. The exact-version exception list covers every locked DSH package at the target. The Cordis-family exceptions from rc.1 are gone because those versions now satisfy the delay.

## Host operator acceptance sequence

The sequence in the [0.2.0-rc.2 handoff](MIGRATION-0.2.0-rc.2.md) still applies: back up retained state, apply the profile only with explicit approval, and restart through the usual service mechanism after selecting the verified checkout-local launcher.

## Validation results

Linux x86-64 cloud container, pnpm `11.9.0`.

| Check                                       | Result                                                           |
| ------------------------------------------- | ---------------------------------------------------------------- |
| Network install with release-age exceptions | Passed; `pnpm peers check` reports no issues                     |
| Every bundle's `build` script               | Passed after the zod alignment; only Codex Compat `dist` changed |
| `node scripts/check.mjs`                    | Passed: one profile recipe and 41 package references             |
| Full Node suite, `pnpm test`                | 1619 passed, 0 failed, 7 skipped                                 |
| Browser and visual suites                   | Not run locally (no matching Playwright browser); left to CI     |
