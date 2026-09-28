# File Intuition

File Intuition adds four Jev-backed tools and a shared `file-intuition` reference skill for fast, first-pass file judgments. It reads bounded source files, asks narrow questions, and returns typed judgments without adding file bodies to the main agent context.

**Source contents leave the machine.** Nonempty evaluations send prepared snapshots and questions to OpenRouter/TypeSafe automatically, without a File Intuition-specific human approval prompt. Calls can incur charges. Secret exclusions are incomplete; do not select confidential material that you cannot disclose.

## Availability

This bundle targets DSH `0.1.7-rc.2` only. The `personal-web` recipe includes it after the existing shared OpenRouter and Jev bundles. It adds a separate **File Intuition** preset derived from Standard; it does not replace Standard, change the default, or alter an existing session. Select the preset for a new session after a separately approved profile update and restart. Check for a duplicate `file-intuition` preset ID before applying a profile.

The bundle reuses `ctx.jev.evaluate`. It adds no provider SDK, credential store, model selector, browser evaluation endpoint, or second Jev service. Configure the shared **Jev** plugin as usual. Its default model is `typesafe/jev-1.13`. Enable these tools only for workspaces whose eligible contents may be sent to that service.

For an explicitly maintained custom preset, add `@local/dsh-file-intuition` to that preset's plugin roster. Keep the host Jev service shared. Do not register File Intuition globally as a replacement for per-session composition. Preset mounts are shared among agents; File Intuition binds each ephemeral preparation to its execution token, actual agent, session, workspace and arguments.

## Tools

| Tool            | Input                                                               | Result                                                                     |
| --------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `ask_file`      | `path`, `questions: [{id, question, criteria?: {true, false}}]`     | Probability of yes for each independent question; no separate confidence   |
| `classify_file` | `path`, `questions: [{id, question, choices: [{id, description}]}]` | One category, distribution, confidence                                     |
| `score_file`    | `path`, `questions: [{id, question, levels: [description, ...]}]`   | Fractional weighted level, distribution, confidence and level descriptions |
| `scout_files`   | `pattern`, `question`, optional `criteria`, optional `maxFiles`     | Independent boolean relevance judgments, ranked by probability             |

All paths and patterns are workspace-relative. `scout_files` supports `*`, `**`, and `?`; `**` is a complete path segment. Patterns are anchored to the workspace root: use `**/*.ts` for nested files. Braces, character classes, negation, absolute paths and `..` are rejected. The tool does not implement full ripgrep glob syntax or `.gitignore` rules.

Each single-file call accepts 1–8 independent questions. Choices need 2–16 options; score rubrics need 2–10 ordered levels. Questions are at most 1,024 characters and each criterion or level at most 512. Question IDs label answers but are not shown to Jev. Use concrete, self-contained criteria. Use separate boolean questions when categories overlap.

The bundled `file-intuition` skill is a tool manual, not an investigation workflow. It covers parameters, input/output examples, question design, independent batching, result semantics, failure handling and disclosure limits. “System 1” describes fast, first-pass judgments, not a latency guarantee or verification method. Model confidence is not correctness. These tools do not produce explanations or code citations and do not authorize actions.

## Safety and privacy contract

- File Intuition uses the injected DSH filesystem and the caller's session cwd. It does not use host filesystem fallbacks, subprocesses, Git, or a process-global cwd to access repository contents. Opaque filesystem target keys are never interpreted as paths.
- DSH's file sandbox fences mutations, not all reads or external disclosure. File Intuition adds its own workspace containment, regular-file checks, symlink rejection, exclusions, version checks, byte limits. Other DSH policies remain in force. It never escalates a filesystem denial.
- Hidden paths, dependency/generated directories, non-text formats, common credential/key files, and recognized private-key or token material are excluded. Both filename and content checks are conservative heuristics, not comprehensive data-loss prevention. Git-ignored files can remain eligible if no File Intuition exclusion applies.
- File Intuition adds no per-call approval request and does not require an approval service. It sends the prepared in-memory snapshots and questions directly to the shared Jev service, not a later reread of changed files. Source bodies do not appear in tool results.
- Execution preparations are bound to the caller, session, workspace and arguments and cannot be replayed. A changed service, model or workspace prevents new dispatch. Other DSH policies can still deny, cancel or request approval; File Intuition preserves those decisions. Empty discovery makes no provider call.
- Prepared content is memory-only, expires with the two-minute tool deadline, and is cleared on cancellation, results or plugin disposal. It is not persisted as an evaluation cache or emitted in tool output. Tool results enter normal DSH history. Remote retention follows provider policy; File Intuition makes no zero-retention promise.
- No automatic retries occur. Cancellation stops queued requests and signals active requests, but cannot retract an already-sent request or guarantee zero charges. The shared Jev service also imposes its own deadline and host-wide concurrency limit.
- Scouting does not emit filesystem observation records. A model classification is not a normal file read for observed-edit authorization.

### Bounds and coverage

| Bound                                           | Limit                                                  |
| ----------------------------------------------- | ------------------------------------------------------ |
| File content                                    | 16 KiB; complete file or skip, never silent truncation |
| Aggregate retained file bodies                  | 128 KiB                                                |
| Evaluated files                                 | Default 12; maximum 24                                 |
| Concurrent Jev requests                         | 2 per scan, subject to shared service capacity         |
| Encoded Jev request                             | 60,000 bytes including model, state and questions      |
| Visited entries / directories / candidate files | 2,000 / 128 / 256                                      |
| Directory nesting depth                         | 12                                                     |
| Snapshot and evaluation deadline                | 120 seconds                                            |
| Pending preparations per preset mount           | 8                                                      |

`coverage.discoveryComplete` concerns the eligible traversal, not every repository file. A cap makes it false. Counts on partial traversals describe observed entries, not an estimated total. Excluded-directory counters count directories, not unseen descendants. Skipped files and provider failures are not negative judgments. Successful evaluations remain available when other files fail. No hard probability threshold removes uncertain candidates.

`usage.providerCalls` counts dispatched requests. `reportedCalls` counts responses with usable usage metadata. Token and `cost` totals appear only when that metric is reported for every dispatched call; `complete` requires all three metrics. `cost` preserves the upstream field's units rather than assigning a new currency contract. Missing totals never mean zero cost.

### Backend limitations

The filesystem API returns an entire directory listing without pagination. File Intuition bounds processing but cannot cap the backend allocation for one enormous directory. Pre/post identity and version checks reduce stale snapshots, but the API provides no atomic no-follow containment-and-read transaction. This is not isolation against a hostile process racing filesystem replacement. Use an appropriately isolated execution environment for adversarial workspaces.

Tests cover opaque remote-style targets, not an actual Docker filesystem transport. The implementation follows the injected filesystem contract; Docker behavior remains a deployment validation step. No live Jev accuracy, cost, latency or calibration benchmark is claimed by the mocked suite.

## Development

After repository setup and any required install approval, run from the repository root:

```sh
node packages/dsh-file-intuition/scripts/typecheck.mjs
node packages/dsh-file-intuition/scripts/build-host.mjs
node --test packages/dsh-file-intuition/test/*.test.js
node packages/dsh-file-intuition/scripts/build-host.mjs --check
node scripts/check.mjs
```

The source uses strict TypeScript with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Committed host JavaScript is generated from it; do not edit generated output. Tests use injected Jev responses, opaque filesystem fixtures and the real DSH Tools pipeline, including preservation of other policies. They require no credentials, network requests or paid calls. Packaging checks verify the skill asset, preset roster, license and generated freshness. Applying a profile, restarting DSH, and live provider validation require separate approval.
