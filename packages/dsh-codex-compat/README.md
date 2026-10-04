# Codex Compatibility

`@local/dsh-codex-compat` is one repository-owned bundle with two Host components: a reviewed Codex sign-in helper and optional Fast mode. Native DSH/pi-ai still owns OAuth, credentials, token refresh, provider configuration and inference. This package does not install community plugins or replace the native Codex adapter.

The bundle is opt-in and is not included in `personal-web`. Source review, build and merge do not install it. A retained-profile migration requires separate approval, backups and the repository’s [migration checks](../../MIGRATION-0.2.0-rc.2.md).

## Components and controls

| Component                       | Cordis row          | Responsibility                                                                      |
| ------------------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| `@local/dsh-codex-compat/oauth` | `local-codex-oauth` | Show native login notices in the terminal and answer login-method/callback prompts. |
| `@local/dsh-codex-compat/fast`  | `local-codex-fast`  | Own the optional request-tier bridge, persisted choices and Fast controls.          |

DSH RC2 discovers a Client half only from a bare package Loader name. The bundle therefore mounts Fast through the package root, which exports the same Host component as `/fast`. This keeps two components and one Client module without a dummy bootstrap plugin.

The components have separate native enable/disable controls. The Fast component also has its own **Fast integration** switch, so you can remove its request modifications without unloading its recovery controls. Neither component depends on the other.

- **Composer → Fast:** Request Fast for this top-level session’s ordinary Codex inference. The adjacent **Higher usage** disclosure explains the cost. New sessions start on Standard.
- **Plugins → `@local/dsh-codex-compat` → `local-codex-fast` → Configure → Fast integration:** Turn the Fast integration off. Codex login and Standard inference remain available.
- **OAuth component Off:** Close this helper’s interaction, request cancellation of its attempt, and stop future automatic terminal login. An already-queued native credential write can still complete, as explained below. Native Models-page sign-in, native refresh and inference remain available.
- **Fast component Off:** Remove its owned request bridge and RPC handlers. This does not unload the OAuth component or remove credentials.

## Sign-in helper

The OAuth component adapts the locally authored helper from the adjacent `dsh-sandbox` repository. It does not implement PKCE, callback listeners, device-code exchange, token refresh, credential locking or grant writes. The native authorization service and pi-ai provide those operations.

At activation, the helper checks that the native `llm-pi-ai/openai-codex` flow offers OAuth. It then starts its login task without waiting for human interaction before Web startup finishes:

1. Read credential **metadata**, not the token-bearing record.
2. If the record exists, leave it unchanged and skip login.
3. Otherwise, delegate to native `authorization.begin` for the same credential key.
4. Display native non-secret notices directly in the terminal. Prefer browser login with a TTY, or device-code login without one. Reject unexpected secret prompts.

The optional manual callback text binds both the whole interaction and native prompt signals. This matters because browser login gives manual input a separate signal. Component disposal or native attempt settlement retires the helper’s input; it does not cancel another caller’s attempt by credential key. Error output is generic and does not echo provider error bodies.

If you explicitly start DSH with `DSH_CODEX_REAUTH=1`, the enabled helper requests a replacement login even when a record exists. The helper never deletes the previous grant; the native flow owns its replacement. Ordinary validation never uses this environment variable against a live account.

**Native cancellation is not credential rollback.** In this DSH/pi-ai release, the native pi credential bridge does not forward the login signal into its queued record mutation. A replacement already queued for the native store can complete after the attempt reports `cancelled`. Do not infer that the previous grant is unchanged solely from a cancelled outcome, and do not retry automatically. This bundle neither patches that credential bridge nor handles token payloads.

This remains a **terminal interaction helper**, not a new browser sign-in interface. Use the native Models page for browser-managed authorization. The helper adds no HTTP or RPC login surface and registers no competing authorization flow.

## Provider configuration and migration

**The bundle never writes the `llm-pi-ai` provider map.** Native pi-ai registers its authorization flows independently of configured routes. Configure or enable `openai-codex` through the native Models page, and keep model lists, capacities and reasoning preferences in native user configuration.

The old sandbox bundle supplied an entire `llm-pi-ai` Config override containing `openai-codex: {}`. Copying that patch here would replace other provider configuration. This bundle deliberately omits it.

Before replacing selected legacy `@local/dsh-codex-oauth` or `@local/dsh-codex-fast` bundles:

1. Back up the profile and native credential store using the approved migration procedure. Keep backups outside Git.
2. Preserve the effective Codex provider/model configuration in the profile’s native settings. Check other providers and the selected model/reasoning effort too. A saved `models` array replaces the inherited catalog.
3. Remove the legacy bundle selections and install the reviewed compatibility bundle through the approved plugin manager procedure. Do not manually write installed package files or run a package manager in the profile.
4. Confirm both new component paths and the existing configured Codex route. An existing grant must skip login. Standard inference must remain available with Fast integration Off.

Stable component row IDs support Loader replacement, but they are not permission to install two competing implementations or rely on bundle order. Keep one selected implementation after migration. Do not delete, copy or reinterpret the credential record to rename a bundle.

The original Fast storage domain `local_codex_fast` (version 1), RPC channel, browser refresh event and isolated session-cache suffix remain unchanged. Existing integration/session choices survive the package rename. The native credential key also remains `llm-pi-ai/openai-codex`. There is no new token store or data migration.

## Fast usage, scope and recovery

Fast uses subscription limits at a higher rate. OpenAI currently documents 2.5× included subscription usage and 2× purchased-credit/Enterprise pay-as-you-go billing for supported models. These are billing multipliers, not guaranteed speed improvements. Availability depends on the model, account, workspace and rollout. See [OpenAI’s Codex speed documentation](https://learn.chatgpt.com/docs/agent-configuration/speed).

Integration Off stops new Fast requests and immediately revokes pending payload construction, even while settings writes are pending. **Payload completion commits an in-flight request:** a body finalized before Off can still be sent as Fast during later WebSocket connection setup, or continue if already sent. Off does not cancel that request or retract its higher usage. Earlier Enable completions cannot undo a later Off.

If an integration or session Off write fails, it still takes effect in this process; the page reports the error. Retry Off to persist it before restarting.

The Fast component uses native schema-validated `storageDomain` storage. A choice binds to the session ID and exact provider/model and survives page reload, resume and Host restart. Selecting another model uses Standard; returning to the previously opted-in model restores that model’s saved choice. Forks, new sessions and subagents do not inherit it. Compaction, title, summary and hand-built model calls are excluded. Integration Off retains choices but makes them inactive; explicitly re-enabling it activates matching choices again.

Only `openai-codex`, the native `openai-codex-responses` API, the built-in ChatGPT endpoint and a reviewed model allowlist qualify. The model must also exist in the configured native catalog. Gateway endpoints do not qualify merely because they use an OpenAI payload shape.

Fast controls use authenticated DSH Connection RPC. No agent tool can enable this higher-usage mode. Enable rejects stale model/revision data; Off remains available with stale revisions. The component never adds session events or changes model-visible prompts/history.

## Compatibility bridge and diagnostics

**Fast uses a version-specific workaround, not a public DSH adapter extension.** This bundle targets DSH `0.2.0-rc.2`; the bridge verifies pi-ai `0.87.1`. Unreviewed versions disable Fast without modifying Standard requests.

The Fast bridge owns:

1. Read-only discovery through DSH’s private adapter registry.
2. Reversible instance-only wrapping of `streamWithSnapshot`, then the actual captured Models collection’s `streamSimple`. This preserves prepared calls across settings snapshots and adapter replacement observed while the component is loaded.
3. Per-request `AsyncLocalStorage` binding downstream construction and iterator operations. Excluded/nested calls receive an empty scope.
4. A composed `onPayload` callback that requests `service_tier: "priority"`. This SDK’s `streamSimple` drops a direct `serviceTier` option.
5. A separate Fast WebSocket session-cache key.
6. Revocation before restoring only methods still owned by this bridge. Retained callback references become transparent when disabled. Native errors and cancellation remain intact.

The bridge does not replace provider registrations, shared prototypes, global fetch, authentication, transport choice, headers, messages or cancellation signals. A retired adapter never visible to this component cannot be instrumented retroactively. Use Fast for subsequent eligible calls, not to upgrade an already-running request during installation.

A bridge failure produces an explicit request/settings error. Turn **Fast integration Off** to return to Standard. No automatic retry silently changes a requested Fast call to Standard.

Diagnostics report **priority requested**, not server tier confirmed. pi-ai’s `onResponse` provides HTTP status/headers, not the effective tier, and is not called by its WebSocket path. DSH’s current stream drops response-tier data. Accurate account eligibility, billing, speed and server-tier acknowledgment require separately approved live verification. No billing metadata or authentication headers are spoofed.

Diagnostics refresh on window focus, manual refresh or reopening the control. They are not a live server-tier feed. Provider failures remain visible through native turn errors.

## Source and development

```text
src/oauth/index.ts       terminal authorization interaction and owned login lifetime
src/fast/index.ts        Fast Host entrypoint
src/fast/runtime.ts      persisted policy and authenticated RPC
src/fast/bridge.ts       private adapter compatibility boundary
client/fast/controls.tsx composer and integration controls
client/index.ts         package-wide native slot registration
shared/contracts.ts     typed Fast RPC contracts
```

Use the repository’s pinned tooling and approved setup procedure. From the repository root:

```sh
node packages/dsh-codex-compat/scripts/build-host.mjs
node packages/dsh-codex-compat/scripts/build-client.mjs
node --test packages/dsh-codex-compat/test/*.test.js
node node_modules/vitest/vitest.mjs run --config vitest.browser.config.mjs packages/dsh-codex-compat/test/browser
node node_modules/@playwright/test/cli.js test --config packages/dsh-codex-compat/test/playwright.config.mjs
```

`pnpm test` checks this package’s types and committed artifact freshness. Regenerate artifacts after changing source. `pnpm run test:visual` runs shared journeys followed by this bundle’s isolated-profile journey.

OAuth tests use native authorization/credential services with synthetic local flows and temporary records. A separate native pi flow test substitutes only the provider’s login result, holds the real store’s record lock, and proves the documented late-write cancellation limit. It does not execute the OAuth protocol. Fast tests use the installed native adapter/SDK with controlled provider, storage and transport effects. The shell journey disables automatic OAuth login in its fixture profile and makes no inference calls. It reuses native Host/authentication/navigation helpers with configured Codex discovery/defaults that conflict with the shared unconfigured-provider profile.

Screenshots are diagnostic test-suite captures of the real isolated DSH application with fixture data, not regression baselines or deployment evidence. No ordinary test reads personal credentials, logs in to OpenAI or performs paid inference.

Community integrations informed the Fast design only: [Pi’s payload-hook extension](https://github.com/calesennett/pi-codex-fast), [DSH model modes](https://github.com/DTSFO/dsh-model-modes), and [OpenCode’s Fast aliases](https://github.com/anomalyco/opencode/pull/21706). No community plugin source or dependency is installed or vendored. Runtime dependencies reuse existing DSH packages and Node built-ins.
