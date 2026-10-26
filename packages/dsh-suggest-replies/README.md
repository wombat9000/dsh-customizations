# Suggested replies

Agent-authored follow-up buttons for DSH Web `0.2.1-rc.3`. The host bundle contributes `suggest_replies` and guidance across presets; it adds no preset or provider request.

The agent calls `suggest_replies({ replies: ["Explain the tradeoff", "Add a regression test"] })` just before its final response. Supply zero to three single-line, plain-text replies, each at most 120 characters. Empty arrays clear suggestions. Whitespace is trimmed and duplicates removed. Invalid inputs fail without publishing suggestions.

The client reads successful results from the latest completed turn's normal session history, including nested calls. The last successful call wins; no suggestions carry into a later turn. Suggestions appear only when that session is open, idle, and has an empty draft with no attachments. They remain hidden for stopped/failed turns, blank sessions, and while typing or submitting. Clicking a button inserts its exact text through the native revision-guarded input action and persists the draft. It never submits, grants approval, or replaces an existing draft. Clear the draft to see the suggestions again.

Tool calls remain visible in DSH's normal work history. This does not hide blocks in assistant messages or replace the native renderer. Restoring a session restores its suggestions from the durable tool result; no separate database, browser cache, RPC endpoint, credentials, or model call is added. Other tool policies remain authoritative. A custom complete system prompt can override the added guidance, and models may omit the tool.

The `personal-web` recipe selects the bundle. Applying it to a running profile and restarting DSH require separate approval; source changes alone do not deploy it. Disable the plugin to remove its tool, guidance, and client contribution.

## Development

Use the repository's installed pinned tooling, without installing new dependencies:

```sh
node packages/dsh-suggest-replies/scripts/build-host.mjs
node packages/dsh-suggest-replies/scripts/build-client.mjs
node --test packages/dsh-suggest-replies/test/*.test.mjs
node node_modules/vitest/vitest.mjs run --config vitest.browser.config.mjs packages/dsh-suggest-replies/test/browser
node node_modules/@playwright/test/cli.js test packages/dsh-suggest-replies/test/real-ui
```

The native raw-schema tool API keeps this package free of host runtime imports. Strict host/client checks and committed-output freshness use the repository's shared build helpers. Tests use fixture histories and real registries, not paid models or a retained profile.
