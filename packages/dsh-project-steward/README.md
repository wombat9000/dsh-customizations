# Project Steward v1

Project Steward is a selectable agent preset for inspecting repository setup, agent guidance, and development practices. It proposes concrete improvements, applies only approved changes, validates them, and summarizes the results. It keeps Standard's coding tools and adds no Creator runtime tools.

This composition-only bundle targets DSH `0.2.0-rc.2` only. Its intentional Standard customizations are the persona, bundled skill provider, and enabled Ralph with `maxRounds: 64`. It has no runtime entrypoint, new dependency, install hook, startup writer, or migration/sync engine. Selecting the preset does not create `AGENTS.md`, install dependencies, or require a directory structure. Approval rules are agent guidance, not a new security boundary; DSH's host sandbox and approval policy still govern tools.

## Install and select

Before applying the bundle:

1. Use a DSH `0.2.0-rc.2` Web profile that supplies `@deepseek-ai/dsh-agent-preset-registry` and Standard's host dependencies. Before dependency work in a source checkout, follow `.agents/skills/repository-setup/SKILL.md` from the repository root (not included in the installed package). No build is needed for this package.
2. Check declarations for the stable preset ID `project-steward` and the Cordis row ID `local-preset-project-steward`. A duplicate preset ID fails registration; installation does not shadow a same-ID preset. With approval, reconcile collisions before proceeding. Keep IDs referenced by saved sessions declared, or review those sessions before removing or renaming a declaration.
3. Inspect the profile's `agent-preset-registry` row. Its `default: standard` is the fallback; `selectedDefault`, when set, overrides it for new sessions. A patch replaces the complete `config`, so preserve any existing `selectedDefault` when editing the row. A legacy `agent-presets` settings default is not the new field; review and migrate the intended selection explicitly.

The bundle's `cordis.patch.yml` inserts one `@deepseek-ai/dsh-agent-preset` declaration with inline `config.plugins`. It does not replace the registry or other declarations. The portable `personal-web` recipe combines this bundle, Worktree workers, and Product mode additively. In a source checkout, inspect `profiles/personal-web/cordis.patch.yml` before application; this file is not included in the installed package. Project Steward does not depend on or grant worktree tools.

With explicit installation approval, use the repository's apply procedure or add `@local/dsh-project-steward` from this package's local directory after the standard Web bundle. If the profile already has a nonempty patch, inspect and reconcile it before approving replacement. Installation, profile application, and restart require separate approval; source changes do not update a running GUI. After an approved restart, select **Project Steward** for a new session. Its stable ID remains `project-steward`. This update does not rewrite session histories or upstream preset files. Saved IDs resolve only while a matching declaration remains available.

Directory-root discovery and the roster `copy()` API are not supported in this version. Existing directory-based custom presets require explicit declarations; retaining an old roots list does not migrate them. Before removing this package, review declarations, defaults, and saved session IDs that reference it.

## Use the preset

Ask, for example: “Audit this repository's agent guidance and setup procedure. Propose changes before writing anything.”

The bundled `project-steward` skill covers:

- Audits of `AGENTS.md`, local skills, scripts, CI, and contributor guidance for missing, conflicting, or stale instructions.
- Concise conditional skill discovery and repo-owned procedures that work without this plugin.
- Toolchain-specific setup, including safe pnpm executable/cache checks, fresh checkout/worktree dependency ownership, offline frozen installs only after approval, and lifecycle scripts disabled by default.
- Validation commands with prerequisites, side effects, evidence, and explicit gaps.

The skill catalog exposes a summary; the body loads on demand. A separate bundled filesystem provider leaves Standard's project, user, and default skill discovery unchanged. Project-specific skill precedence still applies; inspect a same-named project skill before relying on it.

## Adapt templates

The skill carries two Markdown drafting templates under `presets/project-steward/skills/project-steward/templates/v1/`. They are optional, versioned inputs—not generated output or verified procedures. Replace or remove all placeholders, preserve project conventions, and seek approval before creating repo files. Do not claim command execution from static inspection alone.

The bundled skill provider resolves this package's `package.json` from `root.baseUrl` and loads `presets/project-steward/skills`. Templates resolve from the loaded skill's resource directory. Keep the package installed for these assets. A duplicated declaration still references this package unless you separately provide and configure replacement assets; preserve the license when redistributing them. Repository guidance you create from the templates is plain Markdown and needs neither DSH nor this package.

## Validate

The attribution below records the original composition source. See the [DSH `0.2.0-rc.2` migration handoff](../../MIGRATION-0.2.0-rc.2.md) for current-target validation results and limits.

From the repository root, with the existing pinned DSH development dependency available:

```sh
env -u NODE_PATH node --test packages/dsh-project-steward/test/*.test.js
node scripts/check.mjs
git diff --check
```

Tests mount the actual pinned registry and declarations through the Loader, including its volatile `selectedDefault` field. They stage the published file set, compare the composition against installed Standard except for the declared customizations, reject duplicate preset IDs, load scoped skills and templates, and check retained-revision disposal and fixture contents for mutation. Product mode supplies the shared test fixture; these tests do not depend on Worktree tests. These are isolated Node tests, not a GUI deployment or a live model session. Setup fixtures perform no installs; offline install success requires separate authorization and a complete compatible cache.

## Attribution and compatibility

The inline composition derives from `@deepseek-ai/dsh-web-app` `0.1.7-rc.2`, `presets/standard.patch.yml`, at [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) commit `477b4f420553e8a52c2fbccc464d7561b239c443`. The intentional differences are the persona, bundled skill provider, and enabled Ralph with `maxRounds: 64`; upstream Standard disables Ralph. Copyright (c) 2026 DeepSeek; its MIT license is retained as `presets/project-steward/LICENSE.standard`. Original repository additions remain private (`UNLICENSED`).

Tests consume the repository's existing exact-pinned official DSH dependency graph; this package adds no third-party dependency or executable. Compare the complete Standard composition and review its license, tool graph, and resource-path behavior before changing the supported DSH version. Runtime or registry compatibility beyond this pin is unverified.
