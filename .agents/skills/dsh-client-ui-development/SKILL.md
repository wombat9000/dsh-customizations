---
name: dsh-client-ui-development
description: Develop repository-owned DSH client UI with validation proportional to the change; verify slot and hook contracts only when integration boundaries change or evidence is missing.
---

# DSH client UI development

Apply this procedure to changed integration boundaries, not every UI element. If the registration and runtime contract are unchanged, reuse existing evidence and run focused tests. This skill concerns repository-owned client bundles; use `cordis-plugin-development` for temporary runtime extensions.

## Choose the smallest sufficient path

| Change                                                                                                                                                       | Work needed                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Presentation only:** text, spacing, color, or markup inside an existing component                                                                          | Review the affected rendering and run the relevant existing component tests. Do not repeat contract discovery or create a native fixture solely for this change. Check the real shell if inherited styles or layout are involved. |
| **Established behavior:** interaction changes using already-verified registrations and hooks                                                                 | Add or update focused behavior tests and run the relevant existing integration tests. Reuse fixtures and contract evidence.                                                                                                       |
| **Integration boundary:** new or changed registration, unfamiliar hook/service, missing contract evidence, or a DSH version change affecting the integration | Follow the contract check and registration smoke test below before building the full interface. Limit investigation to affected APIs.                                                                                             |

Classify by behavior and risk, not diff size. Changes to authorization, approval data binding, unsafe-content handling, or lifecycle behavior need the corresponding safety tests even when the diff is small. Escalate only the affected part when a focused check exposes an integration problem.

A label correction does not need a new slot smoke test. A new keyboard interaction needs behavior coverage. Moving a component into another slot needs contract verification.

## Verify only new or changed contracts

First identify the package, client entrypoint, and target DSH version. The running GUI may use a different version. Reuse findings from matching-version source, maintained comments, and existing real-runtime tests when the relevant contract is unchanged. Recheck when that evidence is missing, stale, or contradicted by behavior; do not repeat a repository-wide API survey.

For an affected slot, establish:

- **Kind and options:** single, chain, list, or keyed; whether `select` is supported.
- **Election:** priority direction and relevant tie-breaking rules.
- **Props:** selector owner props versus component standard props and injected hooks.
- **Fallback:** what returning null means and which existing UI would be replaced.
- **Lifetime:** how registrations, subscriptions, and effects are removed.

When Inspect is available, discover providers with `cordis_inspect_list`, then use `cordis_inspect_query` for the exact slot and required services. If an essential rule is absent or the running version differs, inspect the matching DSH implementation. Inspect describes contracts, not business data. Do not infer an API from another slot or a permissive mock.

Keep findings in a short task note or relevant code comment. No separate contract document or approval checkpoint is required for routine work.

### Pinned RC2 example, not a universal rule

In DSH `0.1.5-rc.2`, `conversation.approval.detail` is a single slot. Its component is not elected by a chain selector. Lower numeric priority wins; the shipped entry uses `0`. Owner props contain `callId`; component props also provide session hooks. Returning null does not delegate to another entry. The shipped command-detail fallback must be preserved when replacing that entry. Reverify affected assumptions when upgrading DSH.

## Prove an unfamiliar registration first

Run or extend a minimal existing real-shell smoke test before implementing the full UI. Verify that the intended component actually renders through the real slot, receives the correct session/call identity, preserves unrelated behavior, and is removed on disposal. Add a fixture only when existing coverage cannot exercise the changed contract.

A mock asserting the arguments passed to `register()` does not prove that DSH elects the component. A copied native DOM in a component test does not prove integration either. Keep these tests for local behavior, not as substitutes for the runtime check.

## Preserve implementation boundaries

Use documented services and hooks; keep selectors pure. Bind effects to plugin lifetime. Read only the runtime fields required by the UI. Preserve native authorization and execution controls. For approval previews, use the exact prepared data rather than reconstructing changes or fetching replacement values. Keep complete fallback details accessible when presentation data is invalid, and treat external content and links as untrusted.

## Keep validation proportional

Follow [repository setup](../repository-setup/SKILL.md) for prerequisites and [repository test guidance](../../../README.md#run-tests) for available commands.

- During development, run affected test files rather than rebuilding and rerunning every suite after each edit.
- Reuse existing evidence until a relevant change invalidates it. Consolidate broader validation before publication when warranted; existing CI remains unchanged.
- Do not require a new screenshot or baseline update for every UI element. Use baseline comparisons for intentional visual-regression coverage in the pinned environment. Diagnostic screenshots are not baseline comparisons.
- Reuse host startup, authentication, navigation, and cleanup helpers. Restore shared state changed by a test. Do not introduce live credentials, tool execution, or paid model calls into display fixtures.

Existing references, not a new generic fixture API:

- [Disposable host setup](../../../tests/real-ui/global-setup.mjs)
- [Browser fixtures](../../../tests/real-ui/fixtures.mjs)
- [GitHub native approval fixture](../../../tests/real-ui/github-approval-fixture.mjs)
- [Native approval tests](../../../packages/dsh-github/test/real-ui/approval-preview.spec.mjs)

Report exact commands and outcomes, mocked versus real-shell evidence, and relevant limitations. For a small change, a brief summary is enough. Source edits and passing tests do not imply deployment; this skill grants no installation, profile-application, or deployment permission.
