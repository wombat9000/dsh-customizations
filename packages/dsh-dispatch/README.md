# Dispatch

Dispatch is a Host/Client bundle for DSH `0.2.2-rc.3` with two additive agent presets:

| Preset          | ID                | Role                                                                                                                     |
| --------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Dispatch        | `dispatch`        | Coordinates ordinary worker sessions through a restricted toolset. Has no shell or file tools and does no coding itself. |
| Dispatch Worker | `dispatch-worker` | Pinned Standard coding composition plus worker guidance and `dispatch_report`, without native delegation.                |

Workers are ordinary workspace sessions, not native subagents. Their relationship to a coordinator is plugin-owned metadata in DSH's plugin storage domain. Selecting a preset starts nothing, and Standard and any saved default preset or model are unchanged.

## Workflow

1. Select **Dispatch** for a new session and describe the work.
2. Dispatch calls `dispatch_refresh_base` to fetch one configured remote branch and pin its commit. Fetching updates only the remote-tracking ref; no checkout is pulled, reset, or changed.
3. Dispatch calls `dispatch_create_session`. This creates nothing. The conversation shows an approval card with the intent, the complete prompt (in a disclosure), repository, preset, resolved model, proposed branch, and pinned base commit with its fetch time.
4. **Approve** or **Reject** on the card. Approval is consumed once. Dispatch then creates an ordinary session with the worker preset, has the worker's own Agent create a new linked worktree and branch at the pinned commit through DSH's Git Worktrees service, verifies the actual Git registration and the worker's effective directory, records an exclusive claim, and sends the exact approved prompt as a message attributed to the coordinator session. Each completed step appears on the card.
5. The worker reports with `dispatch_report`. Reports arrive in the coordinator conversation as messages attributed to the worker session. Dispatch follows up with `dispatch_send_message` within the approved assignment, or prepares a new assignment card.

Adopting an existing session (`dispatch_add_session`) and giving a worker a new assignment (`dispatch_send_message` with `newAssignment`) use the same card and approval path.

## Authority and isolation

- **User-only decisions.** The card decides through the `/local-dispatch` Connection RPC channel. Connection authenticates the signed browser credential (or an API credential) and the handler accepts only the `owner` principal. The browser sends only the proposal identity, its digest, and the decision, never a prompt, model, or target. There is no agent-callable approval or ownership tool, and permissive session approval policies do not apply.
- **Exact binding.** A decision must match the coordinator session, tool call, proposal ID, SHA-256 digest of the frozen payload, the current ownership generation, and the current Host lifetime. Changed prompts, models, bases, targets, or presets need a new card. Proposals from before a restart expire and are never replayed.
- **Exclusive ownership.** Claims are serialized across every coordinator in the Host, keyed by worker session and canonical checkout path. Another coordinator's worker cannot be read, messaged, or adopted. Release (`dispatch_remove_session`) keeps the session, history, branch, and checkout.
- **Linked worktrees only.** Every managed worker must be on its own registered linked worktree. The main checkout never qualifies. Every targeted operation re-inspects Git and the worker's effective directory; a worker that leaves its checkout loses Dispatch admission until it returns.
- **Coordinator tool restriction.** The coordinator preset registers its tools and a monotonic execution guard that denies every other tool name, including nested calls. On `agent/created`, each coordinator Agent gets a live allowlist in its own scope, so Host-wide tools such as GitHub or File Intuition, and globals registered later, are not visible.
- **Worker restrictions.** Dispatch Worker omits Standard's delegation group (subagents, forks, workflows) and plugin-manager tools, and its guard denies Agent Teams tools, Ralph, and coordinator tools. All tools are denied while a worker is still being provisioned onto its worktree. Normal coding, inspection, tests, and background jobs remain.
- **Reports are data.** A report is bound to the executing worker's own association; there is no caller-supplied recipient or identity. Reports and follow-ups are never treated as user approval, and a draft pull request request does not bypass the worker's normal approvals. Nothing is merged, deleted, or deployed automatically.
- **Shared environment.** Worktrees isolate checkouts only. Databases, ports, credentials, external services, and the execution environment are shared. Guidance and tool guards are not a sandbox against malicious code.

## Tools

Coordinator: `dispatch_list_workspaces`, `dispatch_list_presets`, `dispatch_list_sessions`, `dispatch_find_sessions`, `dispatch_create_session`, `dispatch_send_message`, `dispatch_get_session_status`, `dispatch_read_session`, `dispatch_wait_session`, `dispatch_interrupt_session`, `dispatch_update_session`, `dispatch_add_session`, `dispatch_remove_session`, `dispatch_refresh_base`, plus `ask_user_question`, `todo_write`, and `skill`.

Worker: Standard coding tools plus `dispatch_report`.

## Retained state and recovery

Records live in the `local_dispatch` storage domain: proposals with their checkpoints, managed workers, assignments, and reports. Sessions, branches, and worktrees are never deleted by Dispatch. On Host start, undecided proposals expire, interrupted executions become `uncertain` with their last confirmed step, and pending reports are retried after checking the coordinator's committed log for the recorded message ID. Failures retain partial sessions, branches, and checkouts and are never retried automatically.

## Installation

Dispatch is in the `personal-web` recipe. Installing it, applying the profile, and restarting DSH require separate explicit approval. Before installation, check for duplicate `dispatch` or `dispatch-worker` preset IDs. To keep checkouts when a worker session is archived, set the Git Worktrees plugin's `retainOnArchive` to `true`; DSH's default reclaims a clean, unreferenced checkout when the session that created it is archived.

## Target contracts (DSH 0.2.2-rc.3)

| Contract            | Evidence and adapter                                                                                                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary sessions   | `ctx.sessionController.create({ cwd, agentPreset })`, `resolveAgent()`, and `selectModel()` (`dsh-api-session-controller`).                                                                                                                          |
| Attributed delivery | `agent.followup()` / `agent.steer()` with the `agent-message` source (`kind`, `form: 'relay'`, `senderSessionId`) that `dsh-subagent` registers. The message is built like `createUserMessage` without a runtime dependency.                         |
| Tool restriction    | `tools.restrict({ allow })` in each coordinator Agent's scope and `tools.guard()` in the preset scope (`dsh-tools`). A preset-scope restriction would also hide the preset's own tools from its Agents, which `test/preset.test.js` guards against.  |
| User-only approval  | Connection RPC handlers receive the authenticated Peer; only `principal.kind === 'owner'` may decide (`dsh-client-connection`). The native `approval/request` waterfall is not used: any composed answerer may grant it and it carries no principal. |
| Native worktrees    | `ctx.worktrees.create(workerAgent, { name, from })` changes only the worker's directory (`dsh-experimental-worktree`); `ctx.workingDirectory.get(session)` reads the effective directory.                                                            |
| Durable records     | `ctx.storageDomain.open()` with structural `parse`/`safeParse` validators (`dsh-storage-domain`); no custom session event types.                                                                                                                     |

## Known limitations

- Tools that another plugin registers directly in a coordinator Agent's own scope (for example, a session toggle) stay visible to the model, because rc.3 exempts an Agent's own registrations from `restrict()`. The execution guard still denies them.
- Any `owner`-principal Connection client can decide, including an API client holding the user's credential. Code in the shared execution environment that obtains that credential is out of scope.
- `dispatch_refresh_base` runs `git fetch` from the Host with an argument vector, a timeout, and bounded output, not through DSH's sandboxed subprocess facility. It only fetches configured remotes into their remote-tracking refs.
- Adoption is limited to `dispatch-worker` sessions, so worker restrictions and reporting always apply. Non-Worker adoption is not supported.
- Reports are queued on the coordinator's inbox without extra coalescing. Deduplicated recovery checks the committed log; it is not exactly-once delivery.
- Queue/steer provenance, cold reopen, and report delivery have not yet been exercised against a live agent loop. The shared real-shell journey and an **Open session** control are not implemented yet; the card covers create, adopt, and new-assignment proposals.
- Status refreshes poll the Host every 2 seconds while a proposal is pending or executing.

## Development

From the repository root, with the verified pnpm 11.9.0 and installed dependencies:

```sh
node packages/dsh-dispatch/scripts/build-host.mjs        # dist/ (checked TypeScript)
node packages/dsh-dispatch/scripts/build-client.mjs      # client.js (type-checked first)
env -u NODE_PATH node --test packages/dsh-dispatch/test/*.test.js
pnpm run test:browser                                    # includes test/browser/card.browser.test.mjs
```

`test/service.test.js` owns authority, ownership, approve-once, recovery, and Git behavior with real temporary repositories and a bare fixture remote. `test/preset.test.js` mounts both presets with Standard and Host-wide GitHub tools on a real Loader and tool executor. `test/browser/card.browser.test.mjs` covers the card with real React and DOM.
