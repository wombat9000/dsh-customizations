# Codex Fast

Locally authored, optional Fast mode for the existing DSH Codex/pi-ai inference path. This bundle does not replace or configure the Codex provider, implement OAuth, read credentials, or install third-party plugins.

## Controls and recovery

- **Composer → Fast:** Request Fast for this top-level session’s ordinary Codex inference. The adjacent **Higher usage** disclosure explains the cost. New sessions start on Standard.
- **Plugins → `@local/dsh-codex-fast` → Configure → Fast integration:** Turn the request integration off while keeping this plugin and its recovery controls loaded. Codex login and Standard inference remain available.
- **Plugin component toggle:** Disabling or uninstalling this bundle also removes its owned bridge and RPC handlers. It does not disable `@local/dsh-codex-oauth` or remove its credential record.

Fast uses subscription limits at a higher rate. OpenAI currently documents 2.5× included subscription usage and 2× purchased-credit/Enterprise pay-as-you-go billing for supported models. These are billing multipliers, not guaranteed speed improvements. Availability depends on the model, account, workspace and rollout. See [OpenAI’s Codex speed documentation](https://learn.chatgpt.com/docs/agent-configuration/speed).

Integration Off stops new Fast requests and immediately revokes pending payload construction, even while settings writes are pending. **Payload completion commits an in-flight request:** a body already finalized before Off may still be sent as Fast during later WebSocket connection setup, or continue if already sent. Off does not cancel that request or retract its higher usage. Earlier Enable completions cannot undo a later Off. If an integration or session Off write fails, it still takes effect in this process; the page reports the error. Retry Off to persist it before restarting.

## Scope and persistence

The plugin uses DSH’s schema-validated `storageDomain` facility, in its own `local_codex_fast` domain. It stores the integration switch and session choices outside Git. It never adds unknown session events or modifies model-visible prompts/history.

A choice is bound to the session ID and exact provider/model. It survives page reload, session resume, and Host restart. Selecting another model uses Standard; returning to the previously opted-in model restores that model’s saved choice. Forks, new sessions and subagents have different IDs and do not inherit Fast. Compaction, title, summary and hand-built model calls are excluded. Turning the integration off retains the saved choices but makes them inactive; explicitly re-enabling it makes matching choices active again.

Only the `openai-codex` route, the native `openai-codex-responses` API, the built-in ChatGPT endpoint and a reviewed model allowlist qualify. The model must also exist in the adapter’s configured catalog. A gateway that shares an OpenAI payload shape is not treated as eligible.

Controls use authenticated DSH Connection RPC. No agent tool can enable this higher-usage mode. Enable operations reject stale model/revision data; Off operations are safety-reducing and remain available with stale revisions.

## Compatibility boundary

**This is a version-specific workaround, not a public DSH adapter extension.** The bundle requires DSH `0.2.0-rc.2`; the bridge checks that its installed pi-ai dependency is `0.87.1`. Unreviewed versions disable the Fast capability without altering Standard requests.

The bridge owns:

1. Read-only discovery of the pi-ai adapter through DSH’s private adapter registry.
2. Reversible, instance-only wrapping of `streamWithSnapshot`, then the **actual captured** Models collection’s `streamSimple` method. This preserves prepared calls across settings snapshots and adapter replacement observed while the plugin is loaded.
3. Per-request `AsyncLocalStorage` that binds downstream construction and iterator operations. Excluded/nested calls receive an explicit empty scope.
4. A composed `onPayload` callback that adds `service_tier: "priority"` to the final Codex request body. `streamSimple` does not forward a direct `serviceTier` option in this SDK version.
5. A distinct Fast session-cache key, so Codex WebSocket continuations do not mix Standard and Fast requests.
6. Revocation before restoring only methods still owned by this bridge. Retained callback references become transparent when disabled. Native error and cancellation results remain intact.

The wrapper does not replace provider registrations, shared prototypes, global fetch, authentication, transport choice, headers, request messages, or cancellation signals. A previously retired adapter that was never visible to this plugin cannot be instrumented retroactively. Use the switch for subsequent eligible calls, not to upgrade a request already running during installation.

A bridge failure produces an explicit request/settings error. Turn **Fast integration Off** to return to Standard. There is no automatic retry that silently changes a requested Fast call to Standard.

## Diagnostics and validation limits

The plugin records only that its final payload callback requested priority. It does **not** claim that OpenAI accepted or applied Fast. pi-ai’s `onResponse` exposes HTTP status/headers, not the effective tier; its WebSocket path does not call that callback. The current DSH stream drops the response-tier data. Accurate billing, account eligibility, speed and server-tier acknowledgment require a separately approved live verification. No billing metadata or authentication headers are spoofed.

Diagnostics appear after status refresh, window focus or reopening the control; they are not a live server-tier feed. Provider failures remain visible through DSH’s normal turn errors.

## Development

Use the repository’s pinned tooling and setup procedure. From the repository root:

```sh
node packages/dsh-codex-fast/scripts/build-host.mjs
node packages/dsh-codex-fast/scripts/build-client.mjs
node --test packages/dsh-codex-fast/test/*.test.js
node node_modules/vitest/vitest.mjs run --config vitest.browser.config.mjs packages/dsh-codex-fast/test/browser
node node_modules/@playwright/test/cli.js test --config packages/dsh-codex-fast/test/playwright.config.mjs
```

Host tests use the installed DSH adapter and controlled provider/storage effects, without OAuth or live inference. The shell journey reuses the repository’s disposable Host/authentication procedure with an additional fixture-only Codex profile, because its provider/default configuration conflicts with the deliberately unconfigured visual-regression profile. It verifies generated-bundle mounting, native model projection, authenticated RPC, page-reload persistence, the independent recovery switch and the intact native picker. Screenshots are diagnostic captures of the real isolated application with fixture data, not regression baselines or evidence of deployment.

The full `pnpm test` path checks this package’s types and committed host/client artifact freshness. Regenerate artifacts with the development commands above after changing source. `pnpm run test:visual` runs the shared journeys, then this isolated-profile journey. Tests never apply the bundle to a retained profile, send a prompt, or log in to OpenAI.

## Installation boundary

This package is opt-in and is not added to `personal-web`. Build/review/merge does not install it. Adding it to a retained profile requires separate deployment approval and the repository’s migration/backup checks. Keep the existing Codex OAuth bundle enabled when installing this one.

Community integrations informed the design only: [Pi’s payload-hook extension](https://github.com/calesennett/pi-codex-fast), [DSH model modes](https://github.com/DTSFO/dsh-model-modes), and [OpenCode’s Fast aliases](https://github.com/anomalyco/opencode/pull/21706). No community plugin source or dependency is installed or vendored. The implementation uses existing first-party DSH dependencies and Node built-ins.
