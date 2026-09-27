# DSH 0.1.7-rc.2 migration handoff

This repository now targets **DSH `0.1.7-rc.2` only**. Upgrade the runtime and plugin graph together. Existing consumers can remain on their previously pinned plugin commit until their host operator is ready. No intermediate plugin release is required.

This work does not deploy plugins, restart instances, back up live settings, or convert user histories. The host operator owns those actions and the rollback plan. Do not apply these plugins to a retained `0.1.5` runtime.

## Implementation scope

The matching upstream tag is [`dsh-v0.1.7-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2), commit `477b4f420553e8a52c2fbccc464d7561b239c443`.

- Settings plugins use volatile Loader Config references and stable entry IDs. Custom forms register exact `plugins.row.config` package/row keys. Configure them through **Plugins → installed package → Configure**.
- Credential-only Firecrawl and YouTube forms no longer register empty settings sections. Credential identities stay unchanged.
- OpenRouter reads the current provider configuration through `settings.describe()`.
- Custom presets use explicit, additive `dsh-agent-preset` declarations and `dsh-agent-preset-registry`. The old directory roster is removed.
- Worktree workers emit producer-owned V4 source kinds and use the current job ownership/result contracts.
- Worktree and Session Environment select the unique main-view-retained session. No selection or an ambiguous selection fails closed.
- Session Environment uses current Remote codec factories and `Shell.execute()`/`result()` contracts. Both TypeScript builds force fresh checks.
- GitHub reads pending interactions through `useSessionStatus`. It preserves cancellation and prevents Enter on a preview disclosure from answering the enclosing native approval.

Most diff volume comes from the lockfile, tests, and relocated preset declarations. The scope review found no unrelated feature work. It is not a guarantee that every plugin combination has been tested.

## Required RPC-owner patch

The published target still needs [`dsh-client-connection-0.1.7-rc.2-rpc-owner.patch`](patches/dsh-client-connection-0.1.7-rc.2-rpc-owner.patch). The real-artifact ownership regression fails without the patch and passes with it.

Carry the patch in **each independent launcher and profile dependency graph**. A patched checkout does not patch a separately managed launcher. Keep `pnpm-workspace.yaml`, the patch, and the lockfile together. Never patch shared store files in place.

`apply-profile.mjs` verifies the selected checkout-local launcher, composes bundles, resolves the profile offline with lifecycle scripts disabled, and verifies its resolved Connection implementation. It does not migrate retained state. Application is not transactional; inspect partial changes after failure. Running it against a retained profile requires separate approval.

## Settings adoption before first retained startup

**Back up the complete instance before starting the new runtime.** Include its profile configuration and patches, credentials, `settings.yaml`, runtime data, sessions and child sessions, attachments, and the old launcher/plugin revisions. Keep secrets outside this repository.

The target legacy importer renames `settings.yaml` to `settings.yaml.imported` **before** updating sections. It matches namespaces to entry IDs. Unmapped or invalid sections can be logged and skipped without an automatic retry. A successful startup does not prove that every saved setting was adopted.

Review these mappings in an isolated copy before retained startup:

| Old namespace              | Target entry ID                        |
| -------------------------- | -------------------------------------- |
| `google-auth`              | `local-google-auth`                    |
| `linear`                   | `local-linear`                         |
| `jev`                      | `local-jev`                            |
| `subagent-model-selection` | `subagent-model-selection-settings`    |
| `wombat9000-session-recap` | `wombat9000-session-recap` (unchanged) |

These are entry IDs, not qualified Loader locations. The host operator must also check runtime-owned sections such as `llm-pi-ai`, `ui-onboarding`, `agent-default-model`, and `permission` against the actual target profile. Do not infer that a key is valid because it was present in the old file.

After adoption, compare the effective values, including recap provider/model, Google sandbox mode, subagent routes, and permissions. Saved permissions can differ from profile defaults. Preserve and explicitly review that difference; do not silently widen permissions or discard saved restrictions. Keep credentials in their existing credential store.

This repository provides no automatic mapping script for a live instance. Do not repeatedly rename the imported file to force retries without inspecting which sections already persisted.

## Presets and retained histories

The bundled stable IDs remain `worktree-coordinator`, `project-steward`, and `product-mode`. Duplicate explicit preset IDs fail closed. Convert any machine-owned directory presets separately; do not restore obsolete roster roots over the new declarations.

The personal-web profile selects `standard`. Review a saved custom default and adopt it as the registry's `selectedDefault` when appropriate. Verify that the selected ID resolves to the intended declaration before creating new sessions.

Custom presets retain their intentional enabled Ralph configuration (`maxRounds: 64`). The Worktree coordinator retains its explicit ten-completion-wake cap; target Standard has no explicit cap. This migration does not rewrite the shipped Standard preset.

New histories use V4 step/tool lifecycle rules. The upstream converter handles legacy history sources, including old Worktree plugin sources. Do not manually rewrite user histories from these test fixtures. Validate a copied **complete parent/child state**, not only headers. Earlier header-only inspection found legacy V0/V3 data; it did not establish full-history conversion success.

Machine-owned extensions outside this repository need separate compatibility checks. Examples include launcher identity, sandbox bridges, authentication adapters, and separately sourced copies of these plugins.

## Validation record

All validation uses disposable homes/profiles, synthetic histories, and no real credentials or provider generation. GitHub approval fixtures never dispatch the advertised external operations. Read-only local Git inspection by Session Environment is confined to disposable workspaces.

The disposable Web fixture explicitly sets `DSH_PERMISSION_MODE=danger-full-access`. The pinned browser container lacks both `bwrap` and usable Landlock kernel enforcement; its default workspace-write executor cannot run the Git probe. This fixture-only policy verifies the actual Remote and Shell execution contracts, **not OS sandbox enforcement**. It does not change any retained profile or inherit live permissions. Historical GitHub cards use the native Verbose work-details setting for full-card evidence. Worktree panel captures temporarily hide the independently tested Environment overlay so it cannot obscure the panel.

| Check                                                           | Recorded result                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Full Node suite, `env -u NODE_PATH pnpm test`                   | 1,231 passed; includes forced Session Environment builds                                   |
| Component Chromium suite                                        | 205 passed after the keyboard guard                                                        |
| Fifteen-plugin disposable boot and authenticated read-only RPCs | Passed after final rebuild                                                                 |
| Native-shell interactions                                       | 44 passed on Linux ARM64 with screenshot assertions disabled                               |
| Pinned-container screenshot comparison                          | 44 passed with strict screenshot assertions; changed baselines reviewed and compared twice |
| Frozen offline install and final formatting/build checks        | Passed; Recap typecheck/host/client rebuilds also passed                                   |

The tests distinguish real Loader/persistence/slot integration from component mocks. Synthetic V4 fixtures reopen through the actual target persistence implementation. Native approval tests cover custom previews, keyboard disclosure safety, and the shipped unrelated-command fallback.

Run with `NODE_PATH` unset so an older host's dependencies cannot mask missing target dependencies. Follow the [repository setup procedure](.agents/skills/repository-setup/SKILL.md) and [pinned visual environment](README.md#run-tests). A test pass does not establish retained-instance migration success.

## Dependency risk

The approved dependency upgrade uses exact target pins and disables install scripts. The registry audit found one **moderate** advisory for `fflate@0.8.2`, [`GHSA-px8p-9vwx-vf98`](https://github.com/advisories/GHSA-px8p-9vwx-vf98), through the target's LibreOffice support. The reported fixed version is `0.8.3` or later. No high or critical findings were reported by that audit.

No unapproved override or transitive remediation is included. The host operator should review the upstream dependency risk before deployment. This audit is a point-in-time dependency check, not a complete security assessment.

## Host operator acceptance sequence

1. Record the exact old and target runtime/plugin revisions and prepare a complete rollback snapshot.
2. Validate the target launcher graph, RPC patch, and machine-owned extensions independently of this checkout.
3. Test settings adoption and full history conversion on an isolated copy. Compare effective configuration and saved default preset IDs.
4. Verify plugin row forms, existing-session rendering, session switching, native approval controls, and preset selection without external mutations.
5. Only after explicit deployment approval, update the retained instance and restart it through its existing service mechanism.
6. Recheck effective settings and logs. If acceptance fails, restore the complete matching runtime/profile/state snapshot rather than mixing old code with partially converted state.
