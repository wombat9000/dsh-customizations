# DSH 0.2.0-rc.2 migration handoff

This repository targets **DSH `0.2.0-rc.2` only**. Upgrade the runtime and plugin graph together. All 17 plugins build and pass runtime admission; the Node, component-browser, disposable-host, and pinned native-shell checks pass. This handoff does not authorize profile application, deployment, restart, or retained-state conversion.

The official target is [`dsh-v0.2.0-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2), commit `639ed015397290b3745d163aafe02ffee4aa3f84`.

## Migration scope

- Repinning resolves the 11 identified DSH peer-version blockers. All 17 bundles declare the exact `@deepseek-ai/dsh` peer `0.2.0-rc.2`, including the six bundles that previously declared no DSH peer.
- Each bundle receives a patch-version increment: `0.1.1`, except Worktree workers at `0.2.1`. Package names, Cordis row IDs, credential identities, archive paths, and stable preset IDs remain unchanged.
- The migration retains explicit preset declarations and intentional customizations. Original import provenance and MIT notices remain intact; the new target does not change their historical source.
- The API audit finds no new plugin-specific API break. Native-shell validation does require a fixture-only correction: explicit logged titles and durable projection checkpoints for detached synthetic histories. No production history is rewritten.
- The known message-only OpenRouter RPC failure and Session Recap shortening defects predate this migration. Repinning does not fix them; they remain separate follow-ups.

The [0.1.7-rc.2 handoff](MIGRATION-0.1.7-rc.2.md) remains an unchanged historical record. Its counts and dependency audit are not current-release evidence.

## Required RPC-owner patch

The published `@deepseek-ai/dsh-client-connection@0.2.0-rc.2` artifact still requires the [target-version RPC-owner patch](patches/dsh-client-connection-0.2.0-rc.2-rpc-owner.patch). Its payload is byte-identical to the earlier repair: `getTraceable(this.ctx, this.ctx)`. In an isolated published-artifact control, the plain-WebServer case passes without the patch, but the traced-WebServer case fails with `cannot get property "webServer" without inject`. Both cases pass with the RPC-only patch. A separate Fetch-route disposal control passes both with and without the patch; no Fetch hunk is added.

Carry the patch in **each independent launcher and profile dependency graph**. A patched checkout does not patch a separately managed launcher. Keep the patch, pnpm 11 `patchedDependencies` in the [workspace policy](pnpm-workspace.yaml), and [lockfile](pnpm-lock.yaml) synchronized. Never edit installed package files or shared store inodes in place.

Before an approved profile write, verify the checkout-local launcher version and required Connection implementation. Resolve the complete profile graph offline with lifecycle scripts disabled, then verify its own Web/Connection resolution. Missing cache entries must stop application rather than trigger an online retry. Application is not transactional; inspect partial changes before retrying. Apply-script safety fixtures pass, but no retained profile is applied during this migration.

## Backups and retained state

**Back up the complete instance before its first startup on the new runtime.** Include profile configuration and patches, credentials, settings, runtime data, complete parent/child sessions, attachments, the YouTube archive, and old launcher/plugin revisions. Keep secrets and runtime state outside Git. The host operator owns deployment and a complete rollback plan.

- If retained legacy settings have not yet been adopted, review the [prior settings mappings and importer cautions](MIGRATION-0.1.7-rc.2.md#settings-adoption-before-first-retained-startup) in an isolated copy. Confirm the target importer's behavior before startup. Do not force retries by repeatedly renaming imported files. A successful boot does not prove that every setting was adopted.
- Compare effective permissions, provider/model settings, Google callback mode, Linear workspace binding, and subagent routes. Preserve saved restrictions; do not silently widen permissions or replace credential records.
- Preserve stable presets `worktree-coordinator`, `project-steward`, and `product-mode`. Review duplicate declaration IDs, custom directory presets, registry defaults, and saved session references. Confirm that each saved ID resolves to the intended declaration.
- Validate full copied parent/child histories with target persistence. Header-only inspection and synthetic fixtures do not prove retained-history conversion. Do not manually rewrite live histories from test fixtures.
- Before applying to a retained profile, reconcile its old DSH overrides and old `patchedDependencies` key with the exact target graph. The apply script refuses conflicting overrides; it does not silently remove old patches. Preserve the global release-age delay and do not enable unused-patch tolerance.
- Review old standalone YouTube archive-provider packages and retain only one provider row. Profile application does not automatically remove old packages. Machine-owned sandbox bridges, auth adapters, launchers, and separately sourced plugins need independent checks.

If acceptance fails, restore the complete matching runtime/profile/state snapshot. Do not mix an old runtime with partially converted state.

## Validation results

Host checks run on Linux ARM64 with Node `22.22.1` and pnpm `11.9.0`, with `NODE_PATH` unset. Installation uses the explicitly approved npm cache population, a regenerated lockfile, and lifecycle scripts disabled. The offline verification uses that populated, checkout-owned dependency tree; it does not establish fresh-cache or other-platform install success.

| Check                                                                                | Result                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Frozen, scripts-disabled network install and subsequent offline frozen verification  | Passed                                                             |
| All workspace build scripts, strict contracts, and committed artifact freshness      | Passed; committed generated artifacts remain unchanged             |
| Actual target plugin-admission evaluation                                            | All 17 manifests admitted without exemptions                       |
| `node scripts/check.mjs`                                                             | Passed: one profile recipe and 34 package references               |
| Focused dependency, RPC ownership, and apply-safety tests                            | 22 passed                                                          |
| Full Node suite, `env -u NODE_PATH pnpm test`                                        | 1,495 passed; none skipped                                         |
| Component Chromium suite, `env -u NODE_PATH pnpm run test:browser`                   | 254 passed across 22 files                                         |
| Seventeen-plugin boot, persisted V4 fixtures, authenticated shell and read-only RPCs | Passed                                                             |
| Native-shell journeys and strict screenshot comparison                               | 17 passed in the pinned Linux ARM64 container; no baseline changes |
| Formatting and diff whitespace                                                       | Passed                                                             |

The browser suite reports React `act(...)` and Vite-hook warnings without failures. Tests use isolated homes, profiles, workspaces, synthetic history, and allowlisted environments. They do not authenticate real provider accounts, invoke paid models, mutate external trackers, or change a retained instance.

The pinned native-shell run uses `mcr.microsoft.com/playwright:v1.62.0-noble@sha256:baed2032d533817f3dbe6425de795788430ba345e819a1201337009ba17c9d07` on `linux/arm64`. It runs the unchanged Playwright configuration with an isolated output subdirectory. The default output path contains pre-existing files that this checkout user cannot remove; those artifacts remain untouched. An initial unpinned local attempt is not screenshot acceptance evidence.

The [shared display fixture](tests/real-ui/session-fixture.mjs) logs deterministic user titles and writes native projection checkpoints only after flushing, closing, and independently reopening the persisted log. Target cold listings consume cached title projections, not a directory-name fallback or a full history scan. The primary native-persistence test covers all five histories, cache-write failure, and the absence of tools, agents, and model services. Missing logged titles and missing cold checkpoints each fail the regression control before repair. This is fixture preparation, not a retained-history migration or restored tool authority.

Fixture `danger-full-access` exercises Remote and Shell contracts, **not OS sandbox enforcement**. Follow the [repository setup procedure](.agents/skills/repository-setup/SKILL.md) and [validation environment](README.md#run-tests). Automated passes do not establish retained settings/history conversion, machine-owned extension compatibility, real provider consent, or live deployment success.

## Dependency risk

The approved graph uses official exact-pinned DSH packages and preserves the global `minimumReleaseAge: 5760` policy. The exact-version DSH exception inventory matches all 278 locked DSH package/version keys; no broad non-DSH exception is added. Reassess these exceptions after the target publications satisfy the release-age delay, coordinating any removal with the apply script's override inventory.

The five new DSH package names in the graph are MIT-licensed official packages without install lifecycle scripts. Registry signatures are advertised but are not independently verified; their metadata advertises no provenance attestations. Upstream also upgrades the maintained [pi-ai](https://github.com/earendil-works/pi) graph from `0.85.1` to `0.87.1`. Review its proxy/SDK additions and platform-native components before deployment. [Koffi `3.1.1`](https://registry.npmjs.org/koffi/3.1.1) is an MIT-licensed native FFI package from [Koromix](https://github.com/Koromix/koffi), replacing the previous graph's `3.2.1`; it supplies platform prebuilts and declares an install script, which this installation does not execute. OpenTelemetry uses Apache-2.0, while inherited LibreOffice support includes MPL-2.0 and native binaries.

Desktop product analytics and product-telemetry rows remain disabled for `personal-web`; this migration does not enable them. Base feedback telemetry remains available under the upstream `FEEDBACK_ONLY` default and honors `DSH_TELEMETRY_DISABLED`. Review its data exposure and the default endpoint `https://dsh-otel-collector.deepseeksvc.com/v1/logs` before deploying the new runtime.

`pnpm audit --json` exits `1` and reports **four moderate findings**, with no high or critical findings:

| Locked package                                                | Advisory                                                                                                    | Reported fixed version |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------- |
| `fflate@0.8.2` through LibreOffice support                    | [Malformed ZIP64 infinite loop, GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98)     | `>=0.8.3`              |
| `fast-uri@3.1.7` through AJV                                  | [Host case normalization, GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj)           | `>=3.1.8`              |
| `ip-address@10.7.0` through the Gen AI/MCP rate-limiter graph | [Mixed-family allowlist comparison, GHSA-j6r3-76f7-8jcv](https://github.com/advisories/GHSA-j6r3-76f7-8jcv) | `>=10.7.1`             |
| `ip-address@10.7.0`, same graph                               | [Unbounded parse diagnostics, GHSA-h3mg-xc3c-68pw](https://github.com/advisories/GHSA-h3mg-xc3c-68pw)       | `>=10.7.1`             |

These vulnerable package versions already appear in the prior lockfile. The current advisory count is not comparable to the historical audit without rerunning that graph against today's database. No unrelated override or transitive remediation is included. Review the upstream risk before deployment; this point-in-time dependency audit is not a complete security assessment.

## Host operator acceptance sequence

1. Record old and target runtime/plugin revisions and prepare a complete rollback snapshot.
2. Verify the target launcher graph, RPC-owner requirement, independent profile graph, and machine-owned extensions.
3. Validate settings and full parent/child state on an isolated copy. Compare effective permissions, telemetry choices, and preset defaults.
4. Check plugin forms, existing-session rendering, session switching, native approvals, and preset selection without external mutations.
5. Only after explicit deployment approval, update the retained instance and restart it through its existing service mechanism.
6. Recheck effective settings and logs. If acceptance fails, restore the complete snapshot.
