# Session Recap

Session Recap shows 1–3 short bullets above the DSH Web composer when you return to a session: the topic, key direction, and where the discussion paused. It targets 40–70 words, with less text for simple threads. The card has no header or controls and disappears after your next message is saved to the conversation. Typing or a failed send does not hide it. Select **Recap** in the session header to request it again. Recaps do not add messages to the transcript.

## Install and configure

This bundle targets DSH `0.1.5-rc.1` and requires the standard base and Web bundles. It ships plain JavaScript; no build step is required. This RC also requires the repository's pinned RPC-owner patch; use the patched launcher/profile setup in the [migration guide](../../MIGRATION-0.1.5-rc.1.md), not an unpatched global launcher.

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

Settings include automatic recaps, the inactivity interval (default: 30 minutes), and the provider/model route. Settings use DSH's settings service. With the standard file backend, they live under `DSH_HOME` and can be shared by profiles using that same Harness home; they are not stored in this repository.

To install independently, select `@wombat9000/dsh-session-recap` from `packages/dsh-session-recap` in a recipe after the base and Web bundles. Do not install another copy of this bundle into the same profile.

## Behavior and limits

- Recaps run on return, not while you are away. The plugin uses the browser's recorded activity timestamp when available. On a first visit, it uses the latest persisted human message, assistant message, or turn-end event time instead. Session metadata changes do not reset this fallback. Old sessions can therefore recap automatically in a new browser; recent or empty sessions do not.
- Automatic checks wait for loaded session history and a closed agent turn, retrying once per second while the session remains visible and focused. No automatic request runs without a configured provider/model or when automatic recaps are disabled. Manual generation also rejects an open agent turn.
- A persisted human-message activity event clears the recap and invalidates any pending response for that session. Queued messages hide it when they enter the conversation, not merely when accepted into the queue. **Recap** requests it again and can reuse the host cache.
- Identical session revisions and settings share an in-flight request and an in-memory cached result. The cache holds at most 100 entries and resets when DSH restarts. A changed session or configuration invalidates reuse.
- Each request includes at most 40 visible messages, with a 24,000-byte budget for serialized history. Longer threads retain the first and last 10 eligible messages plus adjacent pairs sampled across the middle. Equal per-message budgets prevent long reports from excluding other turns. Gaps and shortened text are marked explicitly. Sampling can still miss important decisions.
- History excludes tool results, reasoning, attachments, and system or injected messages. Message framing adds a small amount of overhead. The model summarizes the discussion rather than reporting task status; it must not invent agreement, completed work, or next steps. Essential completion claims remain qualified because tools are excluded.
- Output validation requires 1–3 nonempty, single-line bullets, at most 240 characters each and 600 characters combined. The 40–70-word target is a prompt instruction, not a language-dependent word-count check.
- Requests use a 1,400-token output setting, a 45-second timeout, and a maximum of four concurrent generations. Provider billing and cancellation behavior still depend on the adapter.
- Summary text stays in host/browser memory. Browser storage contains activity timestamps, scoped by an opaque hash of the Harness home, host working directory, and plugin namespace, plus the session ID. This is not a distinct profile identity.
- The selected provider receives conversation text. Choose a provider appropriate for your session's privacy requirements. A recap is generated text, not an authoritative record.

This version regenerates from bounded conversation excerpts after a revision changes. It does not feed an earlier generated summary back to the model, which avoids carrying forward unsupported claims.

## Development

```sh
pnpm install --ignore-scripts
pnpm test
pnpm run check
```

The host registers `/session-recap` RPC handlers and the `wombat9000-session-recap` settings namespace. The client registers the existing `conversation.input.dock` and `settings.plugin.item` slots. It does not patch DSH core, replace transcript renderers, or start a web server.

Tests cover model routing, input/output bounds, caching, concurrent requests, failure handling, and browser return detection without making model calls. Live provider generation and visual behavior require installation in a DSH Web profile and a browser smoke test.
