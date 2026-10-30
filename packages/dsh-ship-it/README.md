# Ship it

`@local/dsh-ship-it` adds **Ship it** to the top-right header of an existing top-level DSH conversation. It targets DSH `0.2.1-rc.5` only and uses the native session-scoped conversation service.

Clicking the button sends the exact shipping instructions from [client/prompt.ts](client/prompt.ts) as one ordinary user message to that session: commit all changes, fetch/rebase onto `origin/main`, run the full suite, and push. Substantive conflicts still require the agent to check with you; failing checks can be ignored only after reproducing them on `origin/main`. Tests must not be repeated after later fetches/rebases unless conflict resolution or local edits changed files.

**Clicking Ship it asks your agent to commit and push all changes, including uncommitted work.** The button does not run Git, bypass approvals, or verify that shipping succeeded. The agent's reply and native conversation remain the source of truth. Your composer draft, references and attachments are not submitted, replaced or cleared.

The button is hidden for blank sessions and subagents. It is disabled while the session is opening, running or accepting another message, when prompting is not permitted, or when another plugin blocks the composer. A pending click cannot submit twice. An unconfirmed submission shows a warning and is never retried automatically; check the conversation before trying again.

## Install and enable

The `personal-web` recipe includes this bundle with row ID `local-ship-it`. Check for duplicate row IDs before an approved profile application and restart. Source changes do not update a running profile. Disable **Ship it** through DSH's native Plugins page to remove the button. There is no preset, credential, setting or server endpoint to configure.

## Development

Use the repository's approved dependency procedure. No new third-party version is introduced; the workspace links the same pinned DSH/React peers already in the lockfile.

- `node packages/dsh-ship-it/scripts/build-client.mjs` strictly type-checks and regenerates the committed `client.js` using the shared client builder.
- `node --test packages/dsh-ship-it/test/*.test.mjs` checks client types and publication freshness; it is included in root `pnpm test`.
- `node node_modules/vitest/vitest.mjs run --config vitest.browser.config.mjs packages/dsh-ship-it/test/browser/button.browser.test.mjs` checks availability, pending admission, duplicate clicks and errors with real React.
- `node node_modules/playwright/cli.js test packages/dsh-ship-it/test/real-ui/ship-it.spec.mjs` loads the generated bundle in the shared disposable DSH shell. It checks exact native RPC payload/session identity, preserved drafts, keyboard activation, themes, narrow layout and errors. Prompt admission is intercepted before the Host, so no model, Git command or push runs. Diagnostic captures are not ARM64 visual-baseline comparisons.
