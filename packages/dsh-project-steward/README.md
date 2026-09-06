# Project Steward v1

Project Steward is a selectable agent preset for inspecting repository setup, agent guidance, and development practices. It proposes concrete improvements, applies only approved changes, validates them, and summarizes the results. It keeps Standard's coding tools and adds no Creator runtime tools.

This composition-only bundle targets DSH `0.1.2-rc.1`. It has no runtime entrypoint, new dependency, install hook, startup writer, or migration/sync engine. Selecting the preset does not create `AGENTS.md`, install dependencies, or require a directory structure. Approval rules are agent guidance, not a new security boundary; DSH's host sandbox and approval policy still govern tools.

## Install and select

Before applying the bundle:

1. Use a compatible Web profile that already supplies the `agent-presets` roster and Standard's host dependencies. Before dependency work in a source checkout, follow `.agents/skills/repository-setup/SKILL.md` from the repository root (not included in the installed package). No build is needed for this package.
2. Check for a user preset named `project-steward`. Configured package roots precede the default user root, so installation shadows a colliding ID, including saved selections. Preserve the user's preset under a distinct ID before proceeding, with approval.
3. Inspect custom roster configuration. Cordis replaces the complete `config`, including `roots`; it does not append roots. This bundle's patch lists only its own packaged root and keeps `standard` as the base default. Shipped/user roots remain enabled, and a saved default takes precedence.

The portable `personal-web` recipe selects this bundle and Worktree workers. Its final profile patch explicitly retains both package roots. In a source checkout, read `profiles/personal-web/cordis.patch.yml` from the repository root; this file is not included in the installed package. The worktree bundle is unchanged; Project Steward does not depend on or grant worktree tools. For other profiles, retain all needed roots and custom settings in a later override. When removing either package, remove its root from that override too.

With explicit installation approval, use the repository's apply procedure or add `@local/dsh-project-steward` from this package's local directory after the standard Web bundle. Package resolution uses the installed profile's `package.json` export, not a checkout-specific absolute path. If the profile already has a nonempty patch, the apply script refuses to replace it; inspect and reconcile it before approving replacement. Restart that profile after installation, then select **Project Steward** for a new session. Existing sessions and shipped preset files are not modified. This implementation task does not apply or restart a profile.

## Use the preset

Ask, for example: “Audit this repository's agent guidance and setup procedure. Propose changes before writing anything.”

The bundled `project-steward` skill covers:

- Audits of `AGENTS.md`, local skills, scripts, CI, and contributor guidance for missing, conflicting, or stale instructions.
- Concise conditional skill discovery and repo-owned procedures that work without this plugin.
- Toolchain-specific setup, including safe pnpm executable/cache checks, fresh checkout/worktree dependency ownership, offline frozen installs only after approval, and lifecycle scripts disabled by default.
- Validation commands with prerequisites, side effects, evidence, and explicit gaps.

The skill catalog exposes a summary; the body loads on demand. A separate bundled filesystem provider leaves Standard's project, user, and default skill discovery unchanged. Project-specific skill precedence still applies; inspect a same-named project skill before relying on it.

## Adapt templates and copies

The skill carries two Markdown drafting templates under `presets/project-steward/skills/project-steward/templates/v1/`. They are optional, versioned inputs—not generated output or verified procedures. Replace or remove all placeholders, preserve project conventions, and seek approval before creating repo files. Do not claim command execution from static inspection alone.

The supported roster `copy()` operation copies the whole preset directory to a user root. The skill path resolves relative to the composition's `baseUrl`, and templates resolve from the loaded skill's resource directory. A copied preset therefore keeps working without this bundle installed, provided the compatible Standard host/plugin dependencies remain available. Generated repo guidance is plain Markdown and needs neither DSH nor this package.

## Validate

From the repository root, with the existing pinned DSH development dependency available:

```sh
node --test packages/dsh-project-steward/test/*.test.js
node scripts/check.mjs
git diff --check
```

Tests use the actual pinned roster, loader, skill registry, and dormant host services. They stage the package's published file set, discover installed and copied presets, mount Standard and Project Steward, compare tools/realms, load skill bodies and copied templates, preserve saved defaults, and check fixture contents for mutation. These are isolated Node tests, not a GUI deployment or a live model session. Setup fixtures perform no installs; offline install success requires separate authorization and a complete compatible cache.

## Attribution and compatibility

`agent.cordis.yml` derives from Standard in the official `@deepseek-ai/dsh-agent-presets` `0.1.2-rc.1` package, from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Copyright (c) 2026 DeepSeek; its MIT license is retained as `presets/project-steward/LICENSE.standard`. Original repository additions remain private (`UNLICENSED`).

Tests consume the repository's existing exact-pinned official DSH dependency graph; this package adds no third-party dependency or executable. Compare the complete Standard composition and review its license, tool graph, and resource-path behavior before changing the supported DSH version. Runtime or registry compatibility beyond this pin is unverified.
