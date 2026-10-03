# Global Guidance

This bundle provides independently toggleable guidance themes for DSH **`0.2.0-rc.2`**. It starts with one component, **Visual evidence**. Screenshot capture, provenance, agent handoff, presentation, and screenshot artifact hygiene form one theme and share one toggle. Future independent themes can add their own host rows to this bundle.

## Enable or disable guidance

After an approved profile application, open **Plugins → Global Guidance**. Use **Enable component Visual evidence** to control this theme or **Enable Global Guidance** to control the whole bundle. Visual evidence is enabled by default when the bundle is selected. No separate configuration page or session toolbar switch is added.

Each running component contributes its own named system-prompt section. Disabling a component disposes that contribution; disabling the bundle removes all its component rows. Re-enabling the bundle preserves any component-level disabled setting. With DSH's profile reload service, toggles affect subsequent prompt assemblies. If the host reports that a restart is required, the persisted selection takes effect after that restart. Already-built prompts and prior conversation content do not change.

The contribution is host-wide and preset-neutral. Ordinary scoped assemblies, including native delegated-agent scopes, inherit it without copying a row into each preset. DSH's explicit complete-prompt and same-name scoped overrides remain authoritative; this bundle does not bypass those contracts. It does not edit global or repository instruction files, replace presets, register tools, grant permissions, or run screenshot capture or deletion code.

## Visual evidence

The [injected guidance](assets/visual-evidence.md) tells agents to:

- Capture useful screenshot evidence for user-visible UI changes when practical, preferably through existing tests.
- State whether the image comes from a test or separate capture, a real or staged application, fixture or live data, and a diagnostic capture or regression baseline. Never infer deployment from a screenshot.
- Have delegated agents hand accessible screenshot paths and provenance to their parent. The user-facing agent selects and presents the evidence.
- Use task-owned temporary directories for separate captures. Retain selected and handed-off evidence, remove only unused task-owned scratch files, and verify deletion targets. Displaying a file does not prove that a durable copy exists.
- Preserve existing authorization and privacy boundaries. Do not install capture tools, modify live services, update baselines, deploy, or delete unrelated files merely to follow this guidance.

The bundle defines desired behavior across repositories. Each repository still owns its capture commands, fixtures, and artifact locations. This repository's [DSH client UI skill](../../.agents/skills/dsh-client-ui-development/SKILL.md#screenshot-evidence-and-handoff) supplies that local procedure.

## Development and validation

Edit [the theme source](src/visual-evidence.ts) and [the guidance asset](assets/visual-evidence.md), not generated output. The small host component owns its instruction registration through DSH's effect-scoped prompt registry. Native plugin lifecycle and settings own activation; there is no custom guidance registry or duplicate enabled flag.

With the repository's existing pinned development tools, run from the repository root:

```sh
node packages/dsh-global-guidance/scripts/build-host.mjs
node packages/dsh-global-guidance/scripts/build-host.mjs --check
env -u NODE_PATH node --test packages/dsh-global-guidance/test/*.test.js
env -u NODE_PATH node node_modules/@playwright/test/cli.js test packages/dsh-global-guidance/test/real-ui/guidance.spec.mjs --output artifacts/global-guidance
```

The build strictly checks TypeScript and emits the committed host module. Node tests use the real pinned prompt registry, scopes, and Loader with publication files. The disposable-shell journey checks the native bundle/component switches, persisted disabled state, instruction removal and restoration, and package labels through the real Plugins pane. These checks do not prove model compliance with prose or an update to your running profile. No new third-party runtime dependency, custom browser bundle, or screenshot-retention daemon is included.

The `personal-web` recipe selects this bundle. Source and recipe changes do not apply it to a running profile; installation, profile application, and deployment require separate approval.
