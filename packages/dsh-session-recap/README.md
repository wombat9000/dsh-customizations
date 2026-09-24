# Session Recap

Session Recap prepares a short headline and up to three visual cards when optional Jev selection is enabled, or 1–3 standard bullets otherwise. Generation starts when you return after the configured inactivity interval. It keeps the card hidden until you select the recap icon beneath the latest completed assistant response. A steady glow marks an unread recap. Selecting the icon opens or hides the card above the composer without generating it again. If no recap exists, selecting the icon generates one and opens it when ready. Recaps do not add messages to the transcript.

While generation runs, a highlight shimmers across the fixed icon; it does not rotate or pulse. Reduced-motion users see a static indicator. Selecting the icon during automatic generation requests opening when ready without starting another call. If generation fails, the icon shows a warning and lets you retry. Continuing the thread discards the recap and clears its indicator; typing or a failed send does not.

## Install and configure

This bundle targets DSH `0.1.5-rc.2` and requires the standard base and Web bundles. It ships plain JavaScript with a committed client bundle; installation needs no build step. After editing client source files, regenerate that bundle as described under [Development](#development). This RC also requires the repository's pinned RPC-owner patch; use the patched launcher/profile setup in the [migration guide](../../MIGRATION-0.1.5-rc.1.md), not an unpatched global launcher.

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
4. Open **Settings → Plugins → Plugin configuration → Session recap**.
5. Select a model from the instance's provider catalog, then select **Save**. You can enter exact provider and model IDs when the catalog does not list a supported route.

The plugin uses existing provider credentials. It has no default model, API keys, or fallback provider. Saving validates the selected route without generating a summary. Adapter validation does not guarantee that a later remote request succeeds.

Settings include automatic recaps, the inactivity interval (default: 30 minutes), the provider/model route, and **Use Jev to choose recap cards** (off by default). Settings use DSH's settings service. With the standard file backend, they live under `DSH_HOME` and can be shared by profiles using that same Harness home; they are not stored in this repository.

To install independently, select `@wombat9000/dsh-session-recap` from `packages/dsh-session-recap` in a recipe after the base and Web bundles. Do not install another copy of this bundle into the same profile.

## Optional Jev-selected cards

Enable **Use Jev to choose recap cards** only if sending the bounded conversation excerpt through OpenRouter to TypeSafe is acceptable. The option is off by default. Configure the shared key in the [OpenRouter card](../dsh-openrouter/README.md) and the decision model in the [Jev card](../dsh-jev/README.md); Session Recap has no key field. The `personal-web` recipe includes those plugins in dependency order, but applying it remains a separate operation.

When enabled, the pipeline runs in this order:

1. Select the same bounded conversation history used by the standard recap.
2. Ask Jev, in one request, whether each candidate category is supported and useful for a returning reader.
3. Choose up to three supported categories deterministically.
4. Ask the existing recap-writing model to fill only those categories and provide a headline.
5. Validate the JSON locally and render each category with a fixed label, icon, and subtle accent color. Cards appear side by side when space permits and stack on narrow screens.

The category vocabulary is **Direction**, **Decision**, **Key insight**, **Open question**, **Next step**, and **Where we paused**. A category needs a support probability of at least 0.75, usefulness of at least 2 on a 0–3 rubric, and usefulness confidence of at least 0.3. These are initial selection heuristics, not a guarantee of accurate judgments. Explicit criteria distinguish proposals, current agreements, corrections, and unresolved questions. There is no forced minimum of two cards.

The writer can return `null` for a selected category it cannot support, but must produce at least one nonempty card. Each card is limited to 180 characters, with 480 characters combined and a headline of at most 120 characters. The prompt targets 12–20 words per card. No generated label, icon, color, HTML, or component code controls the UI.

DSH `0.1.5-rc.2` does not expose a response-schema control on its LLM interface. The writing request therefore uses JSON instructions and strict local validation, not provider-enforced structured output. A valid but oversized response receives at most one shortening attempt under the same request deadline; malformed responses fail.

If Jev is missing, unconfigured, fails, or finds no suitable categories, the existing writer produces standard bullets and the panel explains the fallback. Fallback results are not cached while Jev selection is enabled, so a later request can recover after configuration or service repair. Disabling Jev uses the standard recap without an additional provider call. Jev selection and writing share the recap's overall deadline and stale-session checks.

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

Edit the focused source files, not the generated `client.js`:

- `src/index.js` registers settings and RPC handlers.
- `src/runtime.js` owns session checks, caching, concurrent requests, and disposal. It re-exports the existing helper API for compatibility.
- `src/history.js` selects and bounds conversation text.
- `src/recap-schema.js` defines the standard writer prompt and validates bullet and card responses.
- `src/generation.js` handles the shared deadline, Jev selection, writer stream, and optional shortening request.
- `src/settings.js` and `src/errors.js` define shared host settings, limits, and errors.
- `src/cards.js` defines Jev questions, ranking, diagnostics, and card-writing instructions.
- `client/` separates RPC helpers, activity storage and return tracking, controller transitions, presentation, styles, and registration.

The pinned DSH loader serves one client file. The dependency-free assembly script joins the client source fragments inside one module-loader factory. It does not transpile code or register additional modules, so the existing loading and hot-reload contract stays unchanged. Client fragments share that factory's scope; their headers identify their responsibilities and dependencies.

From the repository root, regenerate `client.js` after changing client sources, then run the focused tests:

```sh
node packages/dsh-session-recap/scripts/build-client.mjs
env -u NODE_PATH node --test packages/dsh-session-recap/test/*.test.*
node scripts/check.mjs
```

Commit the source changes and regenerated `client.js` together. The tests reject a stale bundle. Existing dependencies are required for the test suite; follow the [repository setup procedure](../../.agents/skills/repository-setup/SKILL.md) before any approved installation.

The host registers `/session-recap` RPC handlers and the `wombat9000-session-recap` settings namespace. The client registers the existing `conversation.chat.assistant-actions`, `conversation.input.dock`, and `settings.plugin.item` slots. It does not patch DSH core, replace transcript renderers, or start a web server.

Tests cover model routing, input/output bounds, caching, concurrent requests, failure handling, module compatibility, and browser return detection without making model calls. The [repository browser suites](../../README.md#browser-interactions-and-real-dsh-screenshots) cover React interactions and real-shell rendering with fixture data. They do not test live provider generation. Source edits and tests do not update a running profile.
