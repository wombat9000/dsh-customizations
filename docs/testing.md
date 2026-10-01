# Test ownership and real-shell journeys

Choose the smallest test boundary that independently detects the regression. Use a small number of coherent Playwright journeys per plugin to prove integration with DSH. One journey per plugin is a starting point, not a quota.

## Choose the primary owner

| Contract                                                                                                       | Primary test boundary                                                                 |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Pure transformations, state transitions, authorization, backend persistence and lifecycle                      | Existing Node/source or in-process service tests with controlled effects              |
| Component rendering, keyboard input, disclosures, validation, loading/error states and content variations      | Vitest Browser Mode with real React and DOM; import source components where available |
| Generated bundle freshness and registration declarations                                                       | Existing build, loader and packaging checks                                           |
| Bundle mounting and slot election in DSH, native controls, browser-to-host RPC and native settings persistence | Playwright against the shared disposable host                                         |
| Inherited DSH styles, shell clipping, themes and responsive integration                                        | Playwright layout assertions and existing screenshot comparisons                      |

A mocked RPC response proves component behavior, not host persistence or authorization. A copied native DOM proves local rendering, not slot election. Keep another test layer when it reaches an independent failure mode that the primary owner cannot observe.

## Author a shell journey

- Start with a user goal, such as reviewing historical GitHub results or configuring a plugin. Reuse the existing disposable host, authentication and navigation helpers.
- Use one fresh browser context per journey. Reuse its page for related interactions and theme/layout checkpoints. Do not share a mutable page between separate tests or make tests depend on execution order.
- Name meaningful phases with `test.step()`. Keep the journey understandable when a step fails. Split unrelated surfaces or incompatible fixtures into separate journeys.
- Keep detailed component variations in Vitest rather than replaying the same behavior in every shell theme. Keep each native surface's mounting check and layout-specific assertions in the shell.
- Capture relevant screenshot states within a journey. Keep existing baseline names and comparison strictness. Diagnostic screenshots are evidence attachments, not visual-regression assertions.
- Make state transitions explicit. Reset viewport, inline width and open disclosures before checkpoints that expect a default state. Return to Chat before helpers that wait for conversation text: DSH retains the selected session tab. Reenter native navigation when a checkpoint needs fresh disclosures or a remounted surface.
- Use the shared theme helper. It waits for real Host settings acceptance when the preference changes, not just optimistic `color-scheme`. Rapid checkpoints otherwise risk an older settings snapshot reverting the visible palette. Do not replace this synchronization with elapsed-time sleeps or hardcoded color assertions.
- Restore host settings and cancel synthetic pending interactions in `finally` or existing teardown hooks. A disabled control can mean a request is still running; wait for a confirmed result before treating cleanup as complete.
- Scope route mocks to the contract they prove. Historical GitHub reads must make no requests; field-result cards legitimately use the status bridge. Remove only the relevant mock before changing surfaces, not the shared request-isolation route.
- Keep incompatible controller fixtures in separate journeys. Recap caches ready results and errors per page/session: theme checkpoints can reuse one ready result, but changing response fixtures does not reset that cache. A real reload is appropriate when the journey explicitly checks a fresh controller; do not add a test-only production reset API.
- Keep credentials, provider calls, live tracker writes and personal runtime state outside the suite. Preserve the host's allowlisted environment and browser request isolation.

## Reorganize existing coverage

1. Read the tests, production owner, fixtures, overlapping suites and relevant history. Use the [test-audit skill](../.agents/skills/test-audit/SKILL.md).
2. Map each original scenario to its retained journey step or lower-level owner before removing it. Record which integration risk still requires shell evidence.
3. Pilot one ownership group. Run the unchanged baseline and candidate in the same environment, with the same worker count, without updating snapshots.
4. Compare runtime, retained screenshots, state isolation and failure diagnostics. A smaller test count is not proof of better coverage or speed.
5. Revise this guidance from the pilot before applying it to other groups. Run affected lower-level suites and full shell comparisons after the reorganization.

Use the [repository test commands and platform requirements](../README.md#run-tests). Do not install tools, change CI, update baselines or modify production behavior merely to reorganize tests.
