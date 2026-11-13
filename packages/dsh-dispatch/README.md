# Dispatch

Dispatch is a Host/Client bundle for DSH `0.2.2-rc.3` with two additive agent presets:

| Preset          | ID                | Role                                                                                                                                                  |
| --------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dispatch        | `dispatch`        | Coordinates ordinary worker sessions through a restricted toolset. Has no shell or file tools and does no coding itself.                              |
| Dispatch Worker | `dispatch-worker` | Pinned Standard coding composition plus worker guidance and `dispatch_report`, without native delegation. The only preset Dispatch creates or adopts. |

Workers are ordinary workspace sessions, not native subagents. Their relationship to a coordinator is plugin-owned metadata in DSH's plugin storage domain. Selecting a preset starts nothing, and Standard and any saved default preset or model are unchanged.

## Workflow

1. Select **Dispatch** for a new session and describe the work.
2. Dispatch calls `dispatch_refresh_base` to fetch one configured remote branch and pin its commit. Fetching updates only the remote-tracking ref; no checkout is pulled, reset, or changed.
3. Dispatch calls `dispatch_create_session`. This creates nothing. The conversation shows an approval card with the intent, the complete prompt (in a disclosure), repository, preset, resolved model, proposed branch, and pinned base commit with its fetch time.
4. **Approve** or **Reject** on the card. Approval is consumed once. Dispatch then creates an ordinary `dispatch-worker` session, pins the approved model on that session only, has the worker's own Agent create a new linked worktree and branch at the pinned commit through DSH's Git Worktrees service, verifies the actual Git registration and the worker's effective directory, then claims the worker and sends the exact approved prompt (attributed to the coordinator session) in one serialized admission. Each completed step appears on the card, and once a worker exists the card offers **Open worker session**, which opens it through DSH's native workspace navigation.
5. The worker reports with `dispatch_report`, naming the assignment ID it reports on. Reports arrive in the coordinator conversation as messages attributed to the worker session. Dispatch follows up with `dispatch_send_message` within the open assignment, or prepares a new assignment card.
6. `dispatch_list_sessions`, `dispatch_get_session_status`, and `dispatch_wait_session` show a **Dispatch workers** card in the conversation: each managed worker's work state and who set it, assignment and whether it is open, runtime, branch, checkout and its check, and latest report, with **Open worker session** and **Refresh**. The card reads the coordinator's own workers from the Host through the same owner-only channel and never sends, decides, or changes anything.

Adopting an existing session (`dispatch_add_session`) and giving a worker a new assignment (`dispatch_send_message` with `newAssignment`) use the same card and approval path. Both require an idle worker with nothing queued, bind the approval to the exact reviewed repository, checkout, branch, and commit (shown on the card), and refuse any drift at execution. Approving a new assignment closes the previous one.

## Authority and isolation

- **User-only decisions.** The card decides through the `/local-dispatch` Connection RPC channel. Connection authenticates the signed browser credential (or an API credential) and the handler accepts only the `owner` principal. The browser sends only the proposal identity, its digest, and the decision, never a prompt, model, or target. There is no agent-callable approval or ownership tool, and permissive session approval policies do not apply.
- **Exact binding.** A decision must match the coordinator session, tool call, proposal ID, SHA-256 digest of the frozen payload (including the reviewed checkout for adoption and new assignments), the current ownership generation, and the current Host lifetime. Changed prompts, models, bases, targets, or presets need a new card. Proposals from before a restart expire and are never replayed.
- **Exclusive ownership.** Claims are serialized across every coordinator in the Host, keyed by worker session and by the checkout's filesystem-provider identity and key. Another coordinator's worker cannot be read, messaged, or adopted. Release (`dispatch_remove_session`) keeps the session, history, branch, and checkout and closes the open assignment.
- **Admission at the effect.** Send, read, interrupt, report, claim, and release each run their final checks and their effect inside one serialized transaction: the claim, generation, current assignment, live session, and checkout are re-read immediately before delivery, so a handoff can never interleave with an in-flight operation.
- **Assignment closure.** Whether an assignment accepts follow-ups and reports is a one-way closure, separate from the displayed work state. A `done` or `failed` report or administrative status, release, or a newly approved assignment closes it; nothing reopens it, and a closed assignment's state cannot be edited. Reports must name the current assignment, so a late report from an earlier task cannot complete a later one.
- **Linked worktrees only.** Every managed worker must be on its own registered linked worktree. The main checkout never qualifies. Every targeted operation re-inspects Git and the worker's effective directory; a worker that leaves its checkout loses Dispatch admission until it returns.
- **Managed execution world.** Repository inspection and `dispatch_refresh_base` run Git through DSH's `subprocess`, `sandbox`, `sandboxPolicy`, and `fs` services, confined under the calling Session's sandbox policy (the coordinator for fetches and new branches, the worker for its checkout), with paths canonicalized by the mounted filesystem provider. Dispatch uses no Host `child_process` or filesystem calls for repository work.
- **Session-local models.** The approved worker model is selected on the worker's own Agent after the session controller's availability checks. DSH's saved default model is never changed.
- **Coordinator tool restriction.** The coordinator preset registers its tools and a monotonic execution guard that denies every other tool name, including nested calls. On `agent/created`, each coordinator Agent gets a live allowlist in its own scope, so Host-wide tools such as GitHub or File Intuition, and globals registered later, are not visible.
- **Worker restrictions.** Dispatch creates and adopts only `dispatch-worker` sessions, so these restrictions and reporting always apply. Dispatch Worker omits Standard's delegation group (subagents, forks, workflows) and plugin-manager tools, and its guard denies Agent Teams tools, Ralph, and coordinator tools. All tools are denied while a worker is still being provisioned onto its worktree. Normal coding, inspection, tests, and background jobs remain.
- **Reports are data.** A report is bound to the executing worker's own association; there is no caller-supplied recipient or identity. Reports and follow-ups are never treated as user approval, and a draft pull request request does not bypass the worker's normal approvals. Nothing is merged, deleted, or deployed automatically.
- **Shared environment.** Worktrees isolate checkouts only. Databases, ports, credentials, external services, and the execution environment are shared. Guidance and tool guards are not a sandbox against malicious code.

## Tools

Coordinator: `dispatch_list_workspaces`, `dispatch_list_presets`, `dispatch_list_sessions`, `dispatch_find_sessions`, `dispatch_create_session`, `dispatch_send_message`, `dispatch_get_session_status`, `dispatch_read_session`, `dispatch_wait_session`, `dispatch_interrupt_session`, `dispatch_update_session`, `dispatch_add_session`, `dispatch_remove_session`, `dispatch_refresh_base`, plus `ask_user_question`, `todo_write`, and `skill`.

Worker: Standard coding tools plus `dispatch_report`.

## Retained state and recovery

Records live in the `local_dispatch` storage domain: proposals with their checkpoints, managed workers, assignments, and reports. Dispatch fails to start if that domain cannot be opened; it never falls back to memory. Sessions, branches, and worktrees are never deleted by Dispatch. On Host start, undecided proposals expire, interrupted executions become `uncertain` with their last confirmed step, and pending reports are retried. A report's message ID and text are fixed before its first delivery attempt; a retry first looks for that ID in the coordinator's live inbox, its durable `agent/inbox/spliced` insertions, and its committed messages, and reuses the same identity if it must deliver. Failures retain partial sessions, branches, and checkouts and are never retried automatically.

## Installation

Dispatch is in the `personal-web` recipe. Installing it, applying the profile, and restarting DSH require separate explicit approval. Before installation, check for duplicate `dispatch` or `dispatch-worker` preset IDs.

Dispatch admits workers only when the Git Worktrees plugin's `retainOnArchive` is `true`. DSH's default (`false`) reclaims a clean, unreferenced checkout when the session that created it is archived, so until it is set, preparing or executing a create or adoption fails with that instruction.

## Target contracts (DSH 0.2.2-rc.3)

| Contract            | Evidence and adapter                                                                                                                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary sessions   | `ctx.sessionController.create({ cwd, agentPreset })` and `resolveAgent()` (`dsh-api-session-controller`). Worker models use `Agent.model.select()` after `ctx.llm` checks; `sessionController.selectModel()` is avoided because it also saves the default. |
| Attributed delivery | `agent.followup()` / `agent.steer()` with the `agent-message` source (`kind`, `form: 'relay'`, `senderSessionId`) that `dsh-subagent` registers. The message is built like `createUserMessage` without a runtime dependency.                               |
| Tool restriction    | `tools.restrict({ allow })` in each coordinator Agent's scope and `tools.guard()` in the preset scope (`dsh-tools`). A preset-scope restriction would also hide the preset's own tools from its Agents, which `test/preset.test.js` guards against.        |
| User-only approval  | Connection RPC handlers receive the authenticated Peer; only `principal.kind === 'owner'` may decide (`dsh-client-connection`). The native `approval/request` waterfall is not used: any composed answerer may grant it and it carries no principal.       |
| Native worktrees    | `ctx.worktrees.create(workerAgent, { name, from })` changes only the worker's directory (`dsh-experimental-worktree`); `ctx.workingDirectory.get(session)` reads the effective directory; `worktrees.config.retainOnArchive` is checked before admission.  |
| Managed Git         | `ctx.subprocess.resolveExecutable/spawn`, `ctx.sandbox.confine` under `ctx.sandboxPolicy.resolve({ session })`, and `ctx.fs.resolve/processPath`, mirroring the Git Worktrees runner (`dsh-subprocess`, `dsh-sandbox`, `dsh-sandbox-policy`, `dsh-fs`).    |
| Inbox identity      | `Agent.inbox.nextTurn/nextStep` and the `agent/inbox/spliced` event's `inserted` messages (`dsh-agent`).                                                                                                                                                   |
| Durable records     | `ctx.storageDomain.open()` with structural `parse`/`safeParse` validators (`dsh-storage-domain`); no custom session event types.                                                                                                                           |

## Known limitations

- Tools that another plugin registers directly in a coordinator Agent's own scope (for example, a session toggle) stay visible to the model, because rc.3 exempts an Agent's own registrations from `restrict()`. The execution guard still denies them.
- Any `owner`-principal Connection client can decide, including an API client holding the user's credential. Code in the shared execution environment that obtains that credential is out of scope.
- Creation and adoption are limited to `dispatch-worker` sessions. Other presets cannot carry the worker guard or `dispatch_report`, so they are refused rather than run unrestricted.
- `dispatch_refresh_base` fetches under the coordinator Session's sandbox policy, so a policy that forbids writing the repository's Git directory or network access makes the refresh fail rather than bypassing it.
- Checkout identity uses the filesystem provider's class name and opaque target key. Moving a Host to a different filesystem provider makes existing claims ineligible until released.
- Reports are queued on the coordinator's inbox without extra coalescing. Recovery recognizes an already admitted copy; it is not exactly-once delivery in general.
- The real-shell journey drives real agent loops with a scripted model route. It proves wiring, attribution, and reopening, not how a real model plans or reports. It covers the create path; adoption and new assignments use the same card and are covered by `test/service.test.js` and the browser tests.
- DSH 0.2.2-rc.3 persona templates know only `{{provider}}` and `{{model}}`; any other variable fails the first turn. The personas therefore do not name the working directory, which DSH's runtime context already gives the model.
- Status refreshes poll the Host every 2 seconds while a proposal is pending or executing.

## Development

From the repository root, with the verified pnpm 11.9.0 and installed dependencies:

```sh
node packages/dsh-dispatch/scripts/build-host.mjs        # dist/ (checked TypeScript)
node packages/dsh-dispatch/scripts/build-client.mjs      # client.js (type-checked first)
env -u NODE_PATH node --test packages/dsh-dispatch/test/*.test.js
pnpm run test:browser                                    # includes test/browser/card.browser.test.mjs
pnpm exec playwright test --config packages/dsh-dispatch/test/playwright.config.mjs   # real-shell journey (part of test:visual)
```

`test/service.test.js` owns authority, ownership, approve-once, admission, assignment closure, target binding, recovery, and model selection with real temporary repositories and a bare fixture remote. `test/world.test.js` runs Git through the real DSH local subprocess and filesystem providers and sandbox policy. `test/preset.test.js` mounts both presets with Standard and Host-wide GitHub tools on a real Loader and tool executor, with real DSH JSON storage. `test/browser/card.browser.test.mjs` covers the proposal and worker-status cards with real React and DOM. `test/shell/journey.spec.mjs` runs the disposable DSH shell with this bundle and a test-only Host plugin (`test/shell/fixture`) that registers a scripted model route and a fixture repository with a bare remote. In the real UI it starts a Dispatch session, approves the card, waits for the worker's live loop to report back, checks the attributed report and the worker-status card, opens the worker session, and reloads to confirm everything reads back from the Host.
