# Engineering guide

Use this guide when implementing or refactoring repository code. It defines defaults for new work, not a requirement to rewrite existing packages. Keep migrations within the approved scope and explain exceptions that affect maintainability or validation.

Follow the [repository setup procedure](../.agents/skills/repository-setup/SKILL.md) for dependencies and tools. Use the [DSH client UI skill](../.agents/skills/dsh-client-ui-development/SKILL.md) for slot contracts and UI validation. This guide does not authorize installations, commits, CI changes, profile application, or deployment.

## TypeScript and contracts

- Default to TypeScript for new plugin code and TSX for React components. Migrate existing JavaScript in approved, bounded steps; do not turn a small fix into a package-wide conversion. Small scripts and fixtures can retain their established JavaScript conventions.
- Enable strict type checking. Check possibly missing indexed values and distinguish omitted properties from properties explicitly set to `undefined`. Keep type-only dependencies out of runtime imports.
- Give shared data and remote procedure call (RPC) contracts explicit types. Associate each endpoint with its payload and result. Represent alternatives, such as success and failure, as unions that callers can narrow.
- Prefer published upstream types. If they are missing or incomplete, define a narrow adapter or interface for the consumed surface. Document the limitation and the evidence supporting the contract. Do not hide integration uncertainty behind broad `any`, context-wide casts, or blanket error suppression.
- Treat external data and caught errors as untrusted until narrowed or validated. Type assertions do not validate JSON. Retain runtime validation for settings, RPC inputs, and model output; document transport boundaries that rely on host validation.
- Run an explicit type check in the package's build and normal test path. Bundling or transpiling successfully does not establish type safety. Add compile-time regression cases for important contracts, including values that must be rejected.

## Module boundaries

- Organize modules around cohesive responsibilities: pure transformations, lifecycle and state, external integration, and presentation. Use explicit imports and exports.
- Keep pure logic independent of React and host services when those dependencies are not needed. Pass clocks, storage, transports, and other effects through narrow interfaces where that makes behavior testable.
- Splitting a file into fragments that share a concatenated lexical scope is not module decomposition. A loader's single-file requirement belongs in the build, not in the source architecture.
- Keep orchestration readable. Extract a helper when it names a meaningful operation or isolates a responsibility, not merely to reduce line count. Avoid arbitrary file-size limits and unnecessary abstraction layers.

## React components

- Use readable TSX with typed props and callbacks. Keep presentation components independently renderable where practical.
- Keep DSH hooks, subscriptions, and RPC orchestration in containers or focused hooks when that separation clarifies responsibilities. Do not require a separate container for every small component.
- Bind effects and subscriptions to the correct lifetime. Preserve stable object identities when effect dependencies rely on them. A transport wrapper that changes identity can change behavior even when its methods return the same values.
- Preserve defensive rendering and escaping. Keep model-provided content separate from trusted labels, icons, styles, and controls.

## Formatting

- Use the repository's exact-pinned Prettier through `pnpm run format` and `pnpm run format:check` from the root. The shared `.prettierrc.json` defines style; do not introduce competing package-level configurations without a specific need.
- For a focused change, run `pnpm exec prettier --write <paths>` with explicit repository-relative paths. Avoid unrelated formatting changes in functional patches. Reserve repository-wide formatting for an approved baseline or formatter upgrade.
- Use the local pinned version in your editor. Do not rely on a global formatter or a command that downloads an unpinned version.
- Respect `.prettierignore`. Generated artifacts, exact-byte fixtures, patches, legal text, and visual baselines retain their own writers and checks. Regenerate affected bundles from formatted source rather than formatting those bundles directly.
- Formatting is not type checking or behavior validation. Run the relevant checks after formatting. Keep intentional formatting changes separate from behavior changes; do not weaken regression tests to accept a formatting-induced behavior change.

## Testing layers

Choose tests according to the responsibility and risk of the change. Do not require every layer for every edit.

| Responsibility                                      | Preferred evidence                                               |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| Pure logic and state transitions                    | Source-module tests with controlled inputs and effects           |
| React rendering and interactions                    | Real React and DOM tests that import source components           |
| Settings, persistence, RPC ownership, and lifecycle | In-process integration with real services and temporary state    |
| Generated artifacts and plugin registration         | Reproducibility, freshness, loader, and registration checks      |
| DSH mounting, inherited styles, and layout          | Targeted real-shell interaction tests and screenshot comparisons |

- Do not use fake React renderers as a substitute for component tests. Keep virtual-machine bundle tests focused on packaging and registration.
- Prefer controlled promises and fake clocks over elapsed-time sleeps for cancellation, timeout, and concurrency tests.
- State which services are real and which boundaries are mocked. In-process service tests do not prove browser transport, authentication, or live provider integration. Source tests do not prove that DSH loads the generated bundle.
- Use isolated test state and fixture provider responses. Do not read personal credentials or histories, or make paid calls in ordinary regression tests. Reuse existing fixture infrastructure rather than creating another test framework.
- Run focused checks during development and consolidate broader checks before publication. Report actual commands, results, and limitations. Use the [repository test guidance](../README.md#run-tests) and package READMEs for exact commands.

## Refactoring and generated artifacts

- Identify the contracts a refactor must preserve: exports, RPC shapes, settings, labels, styling, lifecycle, and persistence behavior. Separate intentional behavior changes from structural changes and add regressions for them.
- When moving or replacing tests, map the old regression cases to their new coverage. A reduced test count can be valid; silently losing assertions is not.
- Review cleanup order, subscriptions, cancellation, stale responses, session isolation, and object identity where affected. Matching rendered output alone does not prove equivalent behavior.
- Treat generated bundles as outputs. Edit source, regenerate through the package build, and check reproducibility and freshness. If the package tracks generated artifacts, include source and artifact updates in the same commit once committing is authorized.
- Do not update screenshot baselines to make a behavior-preserving refactor pass. Investigate differences; update baselines only for intentional visual changes under the existing review procedure.

Keep compiler versions, loader workarounds, and package-specific commands in package configuration and READMEs rather than general policy. [Session Recap's development guide](../packages/dsh-session-recap/README.md#development) provides an example of these boundaries and test layers; its layout is not a mandatory template for every package.
