# DSH 0.2.2-rc.5 migration handoff

This repository targets **DSH `0.2.2-rc.5` only**. Upgrade the runtime and plugin graph together. This handoff does not authorize profile application, deployment, restart, or retained-state conversion.

The official target is [`dsh-v0.2.2-rc.5`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.5), commit `9c2670d3bce5275e0d1610272958121af87787bb`.

Prior release migration handoffs are preserved in Git history. This repository moved from `0.2.2-rc.3` straight to `0.2.2-rc.5`.

## Migration scope

- All bundles and the root development graph pin DSH `0.2.2-rc.5` exactly, including the `@deepseek-ai/dsh` runtime-admission peer. Each bundle receives a patch-version increment.
- Cordis, Schemastery, pi-ai and Codex Compatibility's zod are unchanged from rc.3.
- Since rc.3, upstream changed DeepSeek content-refusal handling (rc.4), fixed the Live Share tunnel worker (rc.4), and made web search pick its provider per model route (rc.5): the base bundle no longer fixes `searchProvider`, so a conversation on a DeepSeek model route uses legacy Messages search and every other route uses the DeepSeek Search API. No local bundle configures web search. No package was added or removed, and the Standard preset is unchanged, so the custom presets need no re-sync.

## Required RPC-owner patch

The published `@deepseek-ai/dsh-client-connection@0.2.2-rc.5` artifact still reads `const owner = this.ctx` in its `rpc` getter. The [target-version RPC-owner patch](patches/dsh-client-connection-0.2.2-rc.5-rpc-owner.patch) normalizes the consumer context with `getTraceable(this.ctx, this.ctx)`.

## Release-age exceptions

The global `minimumReleaseAge: 5760` stays. The exact-version exception list covers every locked DSH package at the target. No Cordis-family or pi-ai exception is needed.

## Codex Fast bridge

`@deepseek-ai/dsh-llm-pi-ai@0.2.2-rc.5` ships the same files as rc.3, as does `dsh-client-connection`; `dsh-base` changes only its web search composition. The bridge therefore accepts the rc.5 adapter version with pi-ai `1.3.0` exactly, with no hook changes. The Agent registry surface that Subagents Fast, GitHub grants, Google Drive and Dispatch use is also unchanged.

## Host operator acceptance sequence

1. Record old and target runtime/plugin revisions and prepare a complete rollback snapshot (profile config/patches, credentials, settings, sessions, attachments, YouTube archive).
2. Verify the target launcher graph, RPC-owner patch, independent profile graph, and machine-owned extensions.
3. Validate settings and copied parent/child state on an isolated copy; compare effective permissions, telemetry choices, and preset defaults.
4. Check plugin forms, existing-session rendering, session switching, native approvals, and preset selection without external mutations.
5. Only after explicit deployment approval, update the retained instance and restart through its existing service mechanism.
6. Recheck effective settings and logs. If acceptance fails, restore the complete snapshot.

## Validation results

Linux x86-64 cloud container, pnpm `11.9.0`.

| Check                                       | Result                                                            |
| ------------------------------------------- | ----------------------------------------------------------------- |
| Network install with release-age exceptions | Passed; `pnpm peers check` reports no issues                      |
| Every bundle's `build` script               | Passed; only version strings changed in Codex and Dispatch `dist` |
| `node scripts/check.mjs`                    | Passed: one profile recipe and 43 package references              |
| Full Node suite, `pnpm test`                | 1671 passed, 0 failed, 7 skipped                                  |
| Browser and visual suites                   | Not run locally (no matching Playwright browser); left to CI      |
