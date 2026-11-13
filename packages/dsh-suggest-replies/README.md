# Suggested replies

Agent-authored follow-up buttons for DSH Web `0.2.2-rc.3`. The host bundle contributes `suggest_replies` and guidance across presets; it adds no preset or provider request.

The agent calls `suggest_replies({ replies: ["Explain the tradeoff", "Add a regression test"] })` just before its final response. Supply zero to three single-line, plain-text replies, each at most 120 characters. Empty arrays clear suggestions. Whitespace is trimmed and duplicates removed. Invalid inputs fail without publishing suggestions.

The client reads successful results from the latest completed turn's normal session history, including nested calls. The last successful call wins; no suggestions carry into a later turn. Suggestions remain visible alongside an existing draft and attachments when that session is open and idle. They stay hidden for stopped/failed turns, blank sessions, blocked or unauthorized composers, submission, and structured command/reference drafts.

- **Click or press Enter/Space:** toggle a suggestion in your draft. Select several to append them on separate lines. Selecting does not send or grant approval.
- **Click a selected suggestion again:** remove only its unchanged inserted text and separator. Other draft text stays intact. If you edit through a suggestion, or repeated text makes its location ambiguous, it becomes ordinary draft text and is no longer selected; the plugin does not guess which user-authored text to delete. Draft text persists across reloads, but selection ownership does not.
- **Hold for 700 ms:** send only that suggestion as an ordinary user message, leaving your draft and attachments intact. A progress fill shows the hold. Releasing early performs the normal draft toggle; moving away, scrolling, Escape, losing focus, or changing sessions cancels the hold.
- **Send now:** the arrow button beside each suggestion sends that suggestion directly. It is keyboard accessible and has the same draft-preserving behavior as holding.

Draft edits use the native revision guard and undo history. Direct sends use native admission and authorization, not composer submission. A session-owned browser-memory latch blocks repeated activation during admission and after a successful RPC until another turn supplies suggestions, including across session view switches. This latch does not survive a page reload or plugin restart. If delivery cannot be confirmed, inspect the conversation before trying again; the plugin never retries automatically.

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
