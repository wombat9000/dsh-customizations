# Session Recap

Session Recap prepares a short headline and up to three visual cards when optional Jev selection is enabled, or 1–3 standard bullets otherwise. Generation starts when you return after the configured inactivity interval. It keeps the card hidden until you select the recap icon beneath the latest completed assistant response. A steady glow marks an unread recap. Selecting the icon opens or hides the card above the composer without generating it again. If no recap exists, selecting the icon generates one and opens it when ready. Recaps do not add messages to the transcript.

While generation runs, a highlight shimmers across the fixed icon; it does not rotate or pulse. Reduced-motion users see a static indicator. Selecting the icon during automatic generation requests opening when ready without starting another call. If generation fails, the icon shows a warning and lets you retry. Continuing the thread discards the recap and clears its indicator; typing or a failed send does not.

## Install and configure

This bundle targets only DSH `0.1.7-rc.2` and requires the standard base and Web bundles. It ships compiled JavaScript with a committed client bundle; installation needs no build step. After editing source files, regenerate the affected outputs as described under [Development](#development). This RC also requires the repository's pinned RPC-owner patch; use the [repository launcher and profile setup](../../README.md#apply-the-starter-profile), not an unpatched global launcher.

1. From this repository, validate and preview the profile:

   ```sh
   pnpm run check
   pnpm run apply -- personal-web --dry-run
   ```

2. Apply the profile:

   ```sh
   pnpm run apply -- personal-web
   ```

3. Start DSH with `dsh --profile personal-web`. If that profile is already running, restart it and refresh the page.
4. Open **Plugins**, select the `@wombat9000/dsh-session-recap` bundle, then select **Configure** for its `wombat9000-session-recap` row.
5. Select a model from the instance's provider catalog, then select **Save**. You can enter exact provider and model IDs when the catalog does not list a supported route.

The plugin uses existing provider credentials. It has no default model, API keys, or fallback provider. Saving validates the selected route without generating a summary. Adapter validation does not guarantee that a later remote request succeeds.

Settings include automatic recaps, the inactivity interval (default: 30 minutes), the provider/model route, and **Use Jev to choose recap cards** (off by default). These are volatile Config fields: Loader updates their live references without remounting the plugin. DSH Settings validates and persists edits in the active profile's `cordis.patch.yml`, addressed by the row's entry ID. They are not a separate home-wide settings document.

When upgrading retained state, DSH imports a legacy `settings.yaml` once and renames it to `settings.yaml.imported`. Session Recap's former `wombat9000-session-recap` namespace matches the shipped entry ID. Review import warnings and the retained file if the row was renamed or unavailable; this repository migration does not modify your live settings.

To install independently, select `@wombat9000/dsh-session-recap` from `packages/dsh-session-recap` in a recipe after the base and Web bundles. Do not install another copy of this bundle into the same profile.

## Optional Jev-selected cards

Enable **Use Jev to choose recap cards** only if sending the bounded conversation excerpt through OpenRouter to TypeSafe is acceptable. The option is off by default. Configure the shared key in the [OpenRouter card](../dsh-openrouter/README.md) and the decision model in the [Jev card](../dsh-jev/README.md); Session Recap has no key field. The `personal-web` recipe includes those plugins in dependency order, but applying it remains a separate operation.

With incremental bookmarks disabled, the pipeline runs in this order:

1. Select the same bounded conversation history used by the standard recap.
2. Ask Jev, in one request, whether each candidate category is supported and useful for a returning reader.
3. Choose up to three supported categories deterministically.
4. Ask the existing recap-writing model to fill only those categories and provide a headline.
5. Validate the JSON locally and render each category with a fixed label, icon, and subtle accent color. Cards appear side by side when space permits and stack on narrow screens.

The category vocabulary is **Direction**, **Decision**, **Key insight**, **Open question**, **Next step**, and **Where we paused**. A category needs a support probability of at least 0.75, usefulness of at least 2 on a 0–3 rubric, and usefulness confidence of at least 0.3. These are initial selection heuristics, not a guarantee of accurate judgments. Explicit criteria distinguish proposals, current agreements, corrections, and unresolved questions. There is no forced minimum of two cards.

The writer can return `null` for a selected category it cannot support, but must produce at least one nonempty card. Each card is limited to 180 characters, with 480 characters combined and a headline of at most 120 characters. The prompt targets 12–20 words per card. No generated label, icon, color, HTML, or component code controls the UI.

The writing request uses JSON instructions and strict local validation, not provider-enforced structured output. A valid but oversized response receives at most one shortening attempt under the same request deadline; malformed responses fail.

If Jev is missing, unconfigured, fails, or finds no suitable categories, the existing writer produces standard bullets and the panel explains the fallback. Fallback results are not cached while Jev selection is enabled, so a later request can recover after configuration or service repair. Disabling Jev uses the standard recap without an additional provider call. Jev selection and writing share the recap's overall deadline and stale-session checks.

### Experimental incremental bookmarks

After enabling **Use Jev to choose recap cards**, you can separately enable **Keep Jev bookmarks as the conversation continues**. Both options default to off. This profile-level opt-in sends bounded new conversation excerpts and relevant earlier passages through OpenRouter to TypeSafe after completed turns, even if you never open a recap. Each evaluation can incur charges. Saving settings does not itself run an evaluation. Disabling Jev stops both selection modes.

The initial bookmark vocabulary contains **Next steps** and **Open questions**. Jev first detects explicit actions and questions in completed messages with nearby context. A separate check compares candidate passages with later messages to identify acceptance, answers, reported completion, or superseding statements. The host retains source passages and message IDs, not generated summaries. Proposals remain distinct from user-approved actions; an assistant's completion statement is only reported completion, not verified execution.

When a recap starts, the host synchronizes pending bookmark work and selects current evidence for the existing writing model. The writer reads the bookmarked source passages and status evidence instead of the entire history. If no current evidence is available, the standard bullet recap remains the fallback. Opening a recap never forces unsupported categories into cards.

Expand **Bookmark details** in the resulting recap to inspect retained source IDs, categories, speakers, scores, current statuses, and the messages behind status updates. **Copy bookmark diagnostics JSON** exports that metadata without passage text, generated recap text, credentials, or raw provider errors. Opening and copying diagnostics makes no evaluation call.

Bookmarks are bounded, in-memory, per-session state. They are not written to the transcript, browser storage, or persistent logs. They reset on runtime restart and session disposal; bootstrap examines a bounded recent window rather than replaying the entire history. Older active candidates can remain outside the recent window until resolved or evicted by the retention cap. Edits, history changes, settings changes, and model changes invalidate affected work. If more new messages arrive than the catchup window covers, retained candidates are reset rather than treated as current across an unchecked gap. A failed evaluation does not advance the successful cursor; an explicit recap can retry after recovery. This is not an exhaustive task tracker: truncation, retention limits, and incorrect model judgments can miss or misclassify evidence.

The first version groups actions or questions by source message. Status questions require all relevant items in that passage to be resolved; partial answers or completion leave the group active. Closed markers are not automatically reopened by later corrections; a new explicit action or question can create a new marker. Excerpts preserve the beginning and ending with a visible omission marker. The writer still receives source evidence and must not treat status labels as independent proof.

Bounds are 12 recent messages for bootstrap/catchup, 24 active and 24 closed markers per session, 100 retained session caches, and four concurrent synchronization jobs. Each request has at most 32 questions and a 64 KB payload guard. Synchronization has a 15-second deadline; recap synchronization and writing share the overall 45-second deadline. These bounds can cause a standard-recap fallback. Selection retains up to three active items, preferring recent evidence with representation of both categories; it does not average repeated scores. Disabling background processing does not require the unchanged writing provider to be available.

This experimental flow has deterministic fixture coverage, not a demonstrated accuracy improvement from live Jev evaluations. Keep the original mode available for comparison. No live profile configuration or paid evaluation is part of the test suite.

### Inspect category selection

For a recap generated with Jev selection enabled, expand **Selection details** in the recap panel. The table shows each category's support probability, usefulness score, confidence, and selection or rejection reason. A category can pass all thresholds but rank outside the top three. “Selected” means selected for the writer; the writer can still omit that card.

The section also shows the returned model identifier, thresholds, and question-set version. Expand **Questions, probabilities, and JSON** to read the exact questions, rubric levels, and full-precision values. The table rounds numbers to three decimal places; threshold comparisons use the full values. Select **Copy diagnostics JSON** to copy the diagnostic snapshot. If clipboard access fails, expand the JSON and copy it manually.

Opening or copying diagnostics makes no model call. The host retains a sanitized snapshot alongside that generation's recap in memory, including when a successful card recap is served from cache. The snapshot contains no conversation text, generated recap text, credentials, session identifiers, or raw provider errors. The plugin does not persist it to logs or browser storage. If you copy it, your clipboard receives that snapshot.

Unavailable evaluations show no scores. Recaps generated before this feature, or with Jev selection disabled, have no **Selection details** section. The feature cannot recover scores from an earlier generation.

## Behavior and limits

- Recaps run on return, not while you are away. The plugin uses the browser's recorded activity timestamp when available. On a first visit, it uses the latest persisted human message, assistant message, or turn-end event time instead. Session metadata changes do not reset this fallback. Old sessions can therefore recap automatically in a new browser; recent or empty sessions do not.
- Automatic checks wait for loaded session history and a closed agent turn, retrying once per second while the session remains visible and focused. No automatic request runs without a configured provider/model or when automatic recaps are disabled. Manual generation also rejects an open agent turn.
- A persisted human-message activity event or a new agent turn clears the recap and invalidates pending responses for that session. Queued messages clear it when they enter the conversation, not merely when accepted into the queue. The icon appears only on the latest completed assistant response. It replaces the former session-header button.
- Identical session revisions and settings share an in-flight request and an in-memory cached result. The cache holds at most 100 entries and resets when DSH restarts. A changed session or configuration invalidates reuse, including a change to the Jev model or provider instance when card selection is enabled.
- Each request includes at most 40 visible messages, with a 24,000-byte budget for serialized history. Longer threads retain the first and last 10 eligible messages plus adjacent pairs sampled across the middle. Each selected message receives an initial equal allowance; short messages release unused bytes to longer messages. The latest 10 eligible messages receive 1.5 times the weight when distributing spare bytes. If shortening is necessary, the excerpt keeps roughly two-thirds from the beginning and one-third from the end, preferring nearby sentence or paragraph boundaries and inserting `[Middle omitted]`. Serialized metadata and JSON escaping count toward the byte limit. Gaps and shortened text remain marked explicitly. Sampling and truncation can still miss important decisions.
- History excludes tool results, reasoning, attachments, and system or injected messages. Message framing adds a small amount of overhead. The model summarizes the discussion rather than reporting task status; it must not invent agreement, completed work, or next steps. Essential completion claims remain qualified because tools are excluded.
- Standard bullet-output validation accepts a headline of up to 120 characters and requires 1–3 nonempty bullets, at most 320 characters each and 600 characters combined. Whitespace is normalized. The prompt targets 240 characters per bullet and 40–70 words overall; those targets are not hard validation limits. Older bullets-only recaps remain supported.
- Requests use a 1,400-token output setting, a 45-second timeout, and a maximum of four concurrent generations. Provider billing and cancellation behavior still depend on the adapter.
- Summary text stays in host/browser memory. Browser storage contains activity timestamps, scoped by an opaque hash of the Harness home, host working directory, and plugin namespace, plus the session ID. This is not a distinct profile identity.
- The selected provider receives conversation text. Choose a provider appropriate for your session's privacy requirements. A recap is generated text, not an authoritative record.

This version regenerates from bounded conversation excerpts after a revision changes. It does not feed an earlier generated summary back to the model, which avoids carrying forward unsupported claims.

## Development

Both the backend and frontend use TypeScript. Edit source files, not the generated `dist/` modules or `client.js`:

- `src/index.ts` declares volatile Config fields and RPC handlers, with each handler checked against its shared endpoint result type. An optional Settings injection binds the custom-page policy and write service to its lifetime.
- `src/runtime.ts` owns session checks, caching, concurrent requests, and disposal. It re-exports the existing helper API for compatibility.
- `src/history.ts` selects and bounds conversation text.
- `src/recap-schema.ts` defines the standard writer prompt and validates bullet and card responses.
- `src/generation.ts` handles the shared deadline, Jev selection, writer stream, and optional shortening request.
- `src/settings.ts` and `src/errors.ts` define shared host settings, limits, and errors.
- `src/cards.ts` defines Jev questions, ranking, diagnostics, and card-writing instructions.
- `src/host-types.ts` describes the consumed injected-service surfaces. Cordis and settings use their published types; the writer/session interfaces cover only what Recap consumes, and optional Jev responses remain untrusted.
- `client/` contains TypeScript modules for RPC helpers, activity storage, return tracking, controller transitions, styles, and registration. `client/index.ts` is the browser entrypoint.
- `client/containers/` connects TSX views to DSH session hooks, controller subscriptions, and settings RPC calls.
- `client/components/` contains TSX views with typed props and callbacks: the recap action, panel, tiles, bullet list, selection table, and settings form.
- `shared/contracts.ts` describes the host protocol: settings, endpoint-specific RPC payloads/results, recap shapes, and selection diagnostics. `client/controller-types.ts` describes client state and subscriptions. Backend producers and frontend consumers share these types. Settings, requests, model output, and Jev answers retain their runtime validation.

`tsconfig.json` (client) and `tsconfig.host.json` (backend) enable strict checking, checked indexed access, exact optional properties, and type-only import enforcement. The pinned TypeScript `6.0.3` compiler checks both sides and compile-time regression cases without emitting files. Run it independently with `node packages/dsh-session-recap/scripts/typecheck.mjs`. Both the build command and the Node test suite enforce this check; tsdown transpilation alone is not a type check.

GitHub and Session Recap share repository-level client build and type-check helpers, with TypeScript, Node/React types, and tsdown pinned in the root development dependencies. The shared `scripts/build-host.mjs` compiler emits ordinary ESM modules under `dist/`; the package entrypoint is `dist/src/index.js`. It does not bundle extra copies of DSH services or change class identity across backend modules. Generated host output is tracked so installation needs no compiler or lifecycle script. Package scripts retain the commands below.

The pinned DSH loader serves one client file. After type checking, `scripts/build-client.mjs` uses pinned tsdown `0.22.2` to compile TS/TSX into one lazy CommonJS factory. React stays external and is supplied by DSH. The build rejects extra output files, unsupported external imports, dynamic imports, and unresolved `process.env` references. It does not bundle another copy of React or register additional loader modules. The committed `client.js` retains the existing installation and hot-reload contract. DSH needs no TypeScript loader at runtime.

Types do not validate received JSON. The RPC adapter records the host-validated protocol without changing transport identity. Rendering keeps its defensive filters. Registration uses a narrow interface for the three consumed slots, including the keyed root-scoped plugin-row slot and its `view` prop. Target SlotCore and React tests verify keyed election, summary rendering, and disposal; they do not replace native-shell validation.

From the repository root, regenerate the affected outputs after editing source, then run the focused tests. `build-host.mjs --check` checks committed backend output without rewriting it. The root test command does not silently regenerate Recap artifacts before checking freshness.

```sh
node packages/dsh-session-recap/scripts/build-host.mjs
node packages/dsh-session-recap/scripts/build-client.mjs
env -u NODE_PATH node --test packages/dsh-session-recap/test/*.test.*
node scripts/check.mjs
```

Commit source changes and the affected generated outputs together once committing is approved. Tests reject stale client or host artifacts. Existing dependencies are required for the test suite; follow the [repository setup procedure](../../.agents/skills/repository-setup/SKILL.md) before any approved installation.

The host registers `/session-recap` RPC handlers. Settings derives the namespace from the actual Loader entry ID, normally `wombat9000-session-recap`; writes use the local entry ID, not an Include-qualified path. The client registers `conversation.chat.assistant-actions`, `conversation.input.dock`, and `plugins.row.config`, keyed by `@wombat9000/dsh-session-recap#wombat9000-session-recap`. Summary view renders no form or RPC calls; page view opens the custom form with its existing save controls. The plugin does not patch DSH core, replace transcript renderers, or start a web server.

### Test layers

- **Types:** `test/typecheck.test.mjs` runs the pinned compiler. `test/types/contracts.ts` verifies accepted values and rejected RPC payloads, response access, component props, controller flags, and slot registrations. `test/host-types/contracts.ts` checks backend results, settings, card labels, writer requests, stream events, and readonly diagnostics. These cases fail if an expected type error disappears.
- **Logic:** Node tests import the history, schema, settings, card-selection, and controller source modules. A package-scoped test hook transpiles TypeScript with the pinned compiler because some supported Node builds disable native type stripping. It does not load the generated client bundle or replace strict checking. Runtime tests retain controlled model streams for cache, cancellation, timeout, and stale-result regressions. These tests need neither React rendering nor a DSH host.
- **React source components:** `test/browser/components.browser.test.mjs` imports the TSX components directly and runs them in Chromium. Presentation tests supply props and callbacks; container tests supply controller/RPC and session-hook fixtures. They cover rendering, escaped text, input callbacks, diagnostics copying, subscriptions, and cleanup.
- **Backend services:** Integration fixtures import emitted `dist/` modules, as installation does. `test/backend-integration.test.js` mounts real pinned Cordis, Include/Loader, ConfigEditor, Settings, `HostConnectionService`, `SessionStore`, and `JsonlSessionPersistence` in process. Settings and session events persist in temporary directories and are restored in fresh contexts. Model calls are controlled fixtures. A dormant route registry and in-memory request/response streams replace the HTTP listener; a fixed authentication capability replaces login. The fixture manually performs the dormant session-load transaction rather than running the agent loop. These tests do not prove browser transport, login, or live model integration.
- **Existing wiring and packaging:** slot-level browser tests still exercise the generated bundle with mocked slots/RPC. Client bundle tests check reproducibility, the lazy factory, external dependencies, and registrations. `test/host-assembly.test.mjs` checks reproducibility, committed file freshness, and the package's executable host entrypoint. The [real-shell suite](../../README.md#browser-interactions-and-real-dsh-screenshots) verifies mounting and screenshots in a disposable DSH application.

Run the focused browser suite and backend suite from the repository root:

```sh
env -u NODE_PATH node node_modules/vitest/vitest.mjs run --config vitest.browser.config.mjs packages/dsh-session-recap/test/browser/
env -u NODE_PATH node --test packages/dsh-session-recap/test/backend-integration.test.js
```

All suites use fixture model responses, not paid provider calls. Backend tests do not read personal settings or session history. Source edits and tests do not update a running profile.
