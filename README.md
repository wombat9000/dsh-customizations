# DSH customizations

This private repository keeps DSH plugin bundles and reproducible profile recipes for one user across several computers. Clone it on each computer, then apply the profiles you need. DSH keeps credentials, sessions, settings, and other runtime state outside this repository.

The plugins target DSH **`0.2.2-rc.5` only**. Existing consumers can stay on their previous commit until their host operator upgrades the runtime and plugin graph together. **Full validation pending.** The published target still requires the RPC-owner patch; its ownership regression fails without the patch and passes with it. See the [migration handoff](MIGRATION-0.2.2-rc.5.md) for scope, evidence gaps, retained-state cautions, and deployment boundaries.

## Prerequisites

Install these tools before you use the repository:

- The checkout-local, patched DSH `0.2.2-rc.5` launcher installed by the frozen dependency command below (a global DSH installation is not upgraded or used by `apply`)
- Node.js `^22.19.0 || >=24.0.0`
- pnpm 12.21.0, already available locally (not an unverified downloader shim)

Before dependency work in any checkout or worktree, follow the [repository setup skill](.agents/skills/repository-setup/SKILL.md). It covers dependency ownership, pinned executable availability, offline cache limitations, and approval boundaries. You can read this Markdown directly without a plugin.

Set `DSH_HOME` before applying a profile if your Harness home is not `~/.dsh`.

### Amp orbs

The executable `.agents/setup` prepares fresh Amp orbs with Node.js 24.20.0 (matching CI), the manifest-pinned pnpm, frozen workspace dependencies, and the matching Playwright Chromium and system dependencies. It checks the repository and builds all local packages. Node downloads are checksum-verified; toolchains stay under `~/.local/share/dsh-customizations-orb`, and a checkout-scoped login-shell hook makes them available to agents and supervised services.

Network provisioning is approved for this orb lifecycle script only. Dependency lifecycle scripts remain disabled; the release-age policy and required DSH patch remain enforced. Normal agent dependency work still follows the offline-first setup procedure above. Setup refuses symlinked dependency directories and never applies a profile, authenticates a user, or starts a persistent DSH host.

Amp snapshots successful setup for reuse by fresh project orbs. Exact snapshots skip setup; stale snapshots retain installed tools and caches while setup reconciles the current lockfile. Warm setup skips existing toolchain/browser downloads and checks system packages before invoking apt. `.agents/resume` only checks readiness and never reinstalls dependencies. These files must reach the project's default branch before future orbs can use them. The browser is suitable for interaction tests; an x64 orb is not the Linux ARM64 container used for visual baselines.

## Apply the starter profile

Before applying to retained state, complete target validation and the [host operator acceptance steps](MIGRATION-0.2.2-rc.5.md#host-operator-acceptance-sequence), including backups and explicit deployment approval. The commands below are a procedure, not a report of a completed `0.2.2-rc.5` install or deployment.

The `personal-web` recipe selects the standard DSH base and Web bundles plus [Global Guidance](packages/dsh-global-guidance/README.md), [Session Environment](packages/dsh-session-environment/README.md), [OpenRouter](packages/dsh-openrouter/README.md), [Jev](packages/dsh-jev/README.md), [File Intuition](packages/dsh-file-intuition/README.md), [Session Recap](packages/dsh-session-recap/README.md), [Project Steward](packages/dsh-project-steward/README.md), [Product mode](packages/dsh-product-mode/README.md), [Dispatch](packages/dsh-dispatch/README.md), [Firecrawl](packages/dsh-web-firecrawl/README.md), [Google auth](packages/dsh-google-auth/README.md), [Google Drive](packages/dsh-google-drive/README.md), [GitHub](packages/dsh-github/README.md), [Linear](packages/dsh-linear/README.md), [Projects](packages/dsh-projects/README.md), [YouTube](packages/dsh-tool-youtube/README.md), [Image generation](packages/dsh-tool-imagegen/README.md), [Trivy](packages/dsh-tool-trivy/README.md), and [Browser recording](packages/dsh-browser-recording/README.md), targeting DSH `0.2.2-rc.5`. Configure the recap model and Firecrawl key through **Plugins → installed package → Configure** on the corresponding plugin row. Firecrawl replaces the profile's search/fetch providers; it requires a key before either web tool can run. Browser recording requires preinstalled browser/media tools in the subprocess execution environment and never records without an explicit user request.

Existing installations need a coordinated DSH and plugin upgrade, not a plugin-only restart on the old runtime. The host operator owns backups, legacy settings adoption, profile composition, and restart. No intermediate plugin release is required. After the upgrade, key changes take effect on the next request without a restart. Keys stay in DSH's credential store (or the launching environment), never in this repository.

1. After the setup procedure's ownership, executable, cache, and approval checks, install dependencies, validate the repository, and build all local packages. If the offline install fails, stop; obtain separate approval for cache population rather than retrying online:

   ```sh
   pnpm install --offline --frozen-lockfile --ignore-scripts
   pnpm run check
   pnpm run build
   ```

2. Preview the commands without changing DSH:

   ```sh
   pnpm run apply -- personal-web --dry-run
   ```

3. Apply and validate the profile:

   ```sh
   pnpm run apply -- personal-web
   ```

4. Start it:

   ```sh
   ./node_modules/.bin/dsh --profile personal-web
   ```

The apply command submits the selected bundles together in recipe order, using `file:` snapshots for local bundles. It does not remove bundles already installed but absent from the recipe. Existing bundle order is retained by DSH; inspect `--dump-config` after updates.

**Required RPC-owner compatibility patch:** the published `@deepseek-ai/dsh-client-connection@0.2.2-rc.5` still needs [`dsh-client-connection-0.2.2-rc.5-rpc-owner.patch`](patches/dsh-client-connection-0.2.2-rc.5-rpc-owner.patch), which normalizes the consumer context with `getTraceable(this.ctx, this.ctx)`. The ownership regression fails against the unpatched target and passes with the patch; the installed target launcher graph also passes. Keep the target-version patch, pnpm 11 `patchedDependencies` in the [workspace policy](pnpm-workspace.yaml), and [lockfile](pnpm-lock.yaml) synchronized. See the [current migration handoff](MIGRATION-0.2.2-rc.5.md#required-rpc-owner-patch) for evidence and limitations.

The apply procedure verifies the checkout-local launcher and the required Connection implementation before writing a profile. The patch must reach each independent profile graph as well as the launcher graph. Preserve workspace YAML settings with a `.bak` backup, use exact target-version pins and narrow release-age exceptions, and resolve the complete profile graph offline with lifecycle scripts disabled. Refuse conflicting overrides and verify the profile's own Web/Connection resolution after the frozen install. Target-version application validation is pending. Missing cache entries remain a hard failure, never an automatic online retry. Review any partial profile changes after an install failure; application is not transactional.

Other launchers, including global `dsh`, are deliberately unsupported by `apply`; `DSH_BIN` may only name this checkout's `node_modules/.bin/dsh`. Keep this checkout at a durable path when using its launcher. No global package, running process, credentials, or history is modified automatically. Restart through your usual service mechanism only after explicitly selecting the verified target launcher. If published-artifact verification confirms the patch is required, carry it in a separately managed launcher's independent dependency graph and validate that graph separately. See the [0.2.2-rc.5 migration handoff](MIGRATION-0.2.2-rc.5.md), including existing settings, preset, and history cautions.

### Bundles in `personal-web`

Each package README documents its full configuration, security boundaries, and development commands. `personal-web` selects DSH's standard base, Web, and native Git Worktrees bundles plus:

| Bundle                                                            | Purpose                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [Global Guidance](packages/dsh-global-guidance/README.md)         | Toggleable cross-preset instruction themes (e.g. Visual evidence).                                                 |
| [Session Environment](packages/dsh-session-environment/README.md) | Floating CWD/Git/live-CI status card and per-session native **Worktree** preference.                               |
| [OpenRouter](packages/dsh-openrouter/README.md)                   | Shared OpenRouter credential card under **Plugins → OpenRouter → Configure**.                                      |
| [Jev](packages/dsh-jev/README.md)                                 | Host-side typed evaluations via OpenRouter's Decisions API (default `typesafe/jev-1.13`).                          |
| [File Intuition](packages/dsh-file-intuition/README.md)           | `ask_file`, `classify_file`, `score_file`, `scout_files` backed by Jev.                                            |
| [Session Recap](packages/dsh-session-recap/README.md)             | Session recap dock with optional Jev-chosen visual cards.                                                          |
| [Suggested replies](packages/dsh-suggest-replies/README.md)       | Preset-neutral `suggest_replies` tool offering up to three follow-ups above the composer.                          |
| [Ship it](packages/dsh-ship-it/README.md)                         | Session-header button sending approved commit/rebase/test/push instructions as a user message.                     |
| [Project Steward](packages/dsh-project-steward/README.md)         | Additive preset for repository setup and guidance audits.                                                          |
| [Product mode](packages/dsh-product-mode/README.md)               | Planning preset and `product-planning` skill for refining projects and GitHub issues.                              |
| [Dispatch](packages/dsh-dispatch/README.md)                       | `dispatch` coordinator and `dispatch-worker` presets with bounded worker pools on linked Git worktrees.            |
| [Firecrawl](packages/dsh-web-firecrawl/README.md)                 | Replaces profile search/fetch providers with Firecrawl (requires API key).                                         |
| [Google auth](packages/dsh-google-auth/README.md)                 | Shared **Google accounts** OAuth configuration, consent, and token refresh.                                        |
| [Google Drive](packages/dsh-google-drive/README.md)               | Default-off per-session toolbar toggle with explicit file/folder read and Sheets edit pickers.                     |
| [GitHub](packages/dsh-github/README.md)                           | Read/write project, issue, PR, and native stack tools via managed `gh` auth, plus session issue-management grants. |
| [Linear](packages/dsh-linear/README.md)                           | Linear workspace binding, read tools, and approval-gated project writes (`@linear/sdk` `92.0.0`).                  |
| [Projects](packages/dsh-projects/README.md)                       | Left-nav page and read-only tools unifying linked GitHub and Linear projects.                                      |
| [YouTube](packages/dsh-tool-youtube/README.md)                    | Gemini-backed YouTube watch/transcript tools and host-wide SQLite transcript archive (`@google/genai` `2.21.0`).   |
| [Image generation](packages/dsh-tool-imagegen/README.md)          | `generate_image` tool returning durable DSH attachments (shares YouTube's `GEMINI_API_KEY`).                       |
| [Trivy](packages/dsh-tool-trivy/README.md)                        | Vulnerability scanning via a separately installed `trivy` executable on `PATH`.                                    |
| [Browser recording](packages/dsh-browser-recording/README.md)     | Explicit-request browser recording using preinstalled browser/media tools.                                         |

`personal-web` preserves `standard` as the default preset. Optional, not in `personal-web`: [Codex Compatibility](packages/dsh-codex-compat/README.md) (terminal OAuth helper and optional Fast mode for DSH `0.2.2-rc.5`).

## Repository structure

```text
packages/                    Installable plugin and composition bundles
profiles/<recipe>/           Ordered bundle selections and profile patches
schemas/                     Recipe schema for editor support
scripts/                     Management commands (dry-run/check need no dependencies)
patches/                     Exact-version required DSH compatibility patches
templates/plugin-bundle/     Starter package to copy
```

### Engineering guidance

Before implementing or refactoring code, read the [engineering guide](docs/engineering.md). It covers TypeScript contracts, module boundaries, React components, testing layers, and generated artifacts. Package READMEs contain package-specific commands and limitations.

### Packages

Each selectable package declares `dsh.bundle.patch` in `package.json`. A package can contain runtime plugin code, a composition-only patch, or both.

Start a package by copying the template:

```sh
cp -R templates/plugin-bundle packages/dsh-example
```

Rename the package and plugin row before use. Then add it to a recipe with a path relative to the recipe directory:

```json
{
  "name": "@your-scope/dsh-example",
  "source": "../../packages/dsh-example"
}
```

The apply script converts this path to an absolute `file:` snapshot source before it calls the checkout-local `dsh plugin`. Each computer can clone the repository at a different durable location; reapply after changing local bundle sources.

### Profile recipes

A profile recipe contains:

- `recipe.json`, which names the target profile and selects bundles in order.
- `cordis.patch.yml`, which contains machine-independent overrides applied after the bundles.

Later bundles override earlier bundle layers. A patch that targets an existing row replaces that row's complete `config`; it does not merge individual fields.

The apply script replaces a missing or empty profile patch automatically. If the target contains custom configuration, the script stops. Inspect the target before you run:

```sh
pnpm run apply -- personal-web --force-patch
```

This option saves the previous target as `cordis.patch.yml.bak`.

To use one recipe with a different local profile name, run:

```sh
pnpm run apply -- personal-web --profile laptop-web
```

## Optional Codex compatibility bundle

[Codex Compatibility](packages/dsh-codex-compat/README.md) packages the reviewed terminal OAuth helper and optional Fast mode as two independently controlled components. Native DSH/pi-ai still owns authentication, credentials, provider configuration, and inference. Fast integration Off preserves login and Standard inference. The bundle targets DSH `0.2.2-rc.5` with pi-ai `0.87.1` and is not included in `personal-web`. Migration from sandbox-only helpers or installation into a retained profile requires separate approval.

## Update another computer

After pulling changes, repeat the setup procedure's executable, ownership, cache, and approval checks before installing. The commands below do not authorize installs or profile changes:

```sh
git pull
pnpm install --offline --frozen-lockfile --ignore-scripts
pnpm run check
pnpm run build
pnpm run apply -- personal-web
```

Run `pnpm run build` before applying the profile (`packages/*/dist/` and `packages/**/client.js` are build outputs excluded from Git, and `apply-profile` verifies they exist). Restart a running DSH process after a host or client plugin changes.

## Formatting

Use the exact-pinned root Prettier dependency after an approved dependency installation. From the repository root:

```sh
pnpm run format:check
pnpm run format
```

`format:check` reports differences without changing files. `format` rewrites maintained source, tests, configuration, and documentation. For a focused edit, use `node node_modules/prettier/bin/prettier.cjs --write <paths>` instead of reformatting unrelated files or invoking pnpm's implicit dependency synchronization. Configure your editor to use the repository's local Prettier and `.prettierrc.json`.

The configuration uses two spaces, single quotes, no semicolons, and a 100-column print width. It preserves prose wrapping and disables embedded-language formatting. `.prettierignore` excludes generated bundles, the pnpm lockfile, byte-controlled fixtures, patch payloads, legal text, and visual baselines. CI runs `pnpm run format:check` for pull requests and pushes to `main`, including workflow files. No Git hook is installed. See the [engineering guide](docs/engineering.md#formatting).

[Prettier](https://prettier.io/docs/install) is an MIT-licensed development tool from the [official Prettier repository](https://github.com/prettier/prettier). The pinned package has no runtime dependencies, install scripts, or native binary downloads. No third-party formatter plugins are added.

## Run tests

See the [migration validation results](MIGRATION-0.2.2-rc.5.md#validation-results) for actual target-version evidence and limitations. Prior test counts and screenshots remain historical evidence, not proof of current compatibility.

If dependencies are missing, follow the [repository setup skill](.agents/skills/repository-setup/SKILL.md) before an approved offline install. Run repository checks with `pnpm run check`, strict type checking across all packages with `pnpm run typecheck`, and the Node.js unit and host-integration tests with `pnpm test`. The test command first runs `pnpm run build` (`node scripts/build.mjs`), which strictly type-checks and builds every local host (`dist/`), client (`client.js`), and Session Environment (`lib/`) bundle. You can target a single package with `node scripts/build.mjs [--host|--client|--typecheck|--check] <package>`.

Generated `dist/`, `client.js`, and `lib/` outputs are excluded from Git and produced by `pnpm run build`. Browser suites import source TSX components directly as well as testing built client bundles; real-shell tests load the built bundles into a disposable DSH instance.

### Browser interactions and real DSH screenshots

There are two browser suites:

- `pnpm run test:browser` runs fast Vitest Browser Mode interactions with real React and mocked RPC/slots. It checks generation, dismissal, errors, expansion, draft retention, and saving. Its simplified layout is **not** a visual baseline for DSH.
- `pnpm run test:visual` targets **one disposable DSH 0.2.2-rc.5 instance for the whole suite** with Playwright. See the [migration validation results](MIGRATION-0.2.2-rc.5.md#validation-results) for historical results before the local Worktree integration was removed. It loads the real plugin bundles, global styles, themes, settings panel, and RPC transport. Screenshots cover collapsed/expanded plugin-row configuration in light/dark mode, plus the recap dock and its unconfigured-provider error. Assertions also check that a new blank session hides the dock. The committed baselines use `toHaveScreenshot`, so changes produce expected/actual/diff images under `artifacts/real-ui/`, uploaded by the existing CI failure-artifact step.

The host uses unique temporary home, profile, and workspace directories. It receives an allowlisted environment without your provider credentials or DSH settings. A test-only host plugin seeds and flushes a completed user turn through DSH's session store; no prompt or provider request creates the fixture. The suite never configures a provider, submits a prompt, or calls a paid model. It authenticates through DSH's normal launch-token exchange outside Playwright, then uses only a cookie and tokenless URL. It does not read or modify a running DSH instance. Teardown terminates the host process group and removes its temporary state; lifecycle tests cover startup failures and descendant cleanup. Abrupt container or machine termination relies on the container/OS cleanup boundary.

The disposable fixture explicitly uses `DSH_PERMISSION_MODE=danger-full-access` because the pinned container lacks usable Landlock and `bwrap`. Session Environment verifies real Remote and Shell calls using read-only Git inspection of disposable directories. This is not OS sandbox-enforcement evidence and changes no live permission settings.

Every journey gets a fresh browser context. Related native interactions and theme/layout checkpoints reuse that journey's page through named Playwright steps. Each theme checkpoint selects its theme through the real General settings UI; session-scoped surfaces reenter native navigation when needed to adopt the new theme. Settings persist on the shared host, so tests that change other settings must restore them. Traces and video are disabled to avoid recording authentication state. Browser requests outside the disposable host are blocked.

Follow [test ownership and real-shell journeys](docs/testing.md) before adding or reorganizing tests. Prefer a small number of coherent integration journeys per plugin, not a strict one-test limit. Detailed component variations belong primarily in Vitest Browser Mode; pure logic and backend lifecycle tests remain in the existing Node suites. Keep separate journeys for incompatible response fixtures or controlled clocks.

The PNG baselines use **Linux ARM64**, the digest-pinned Playwright 1.62.0 Ubuntu Noble image below, and its Chromium/fonts. Viewport, scale, locale, time zone, and fixture content are fixed. Comparisons use a global per-pixel color threshold of `0.1` to ignore small rendering variations, with zero allowed mismatching pixels beyond that threshold. DSH uses system fonts, so these are Linux baselines, not pixel-identical copies of a Mac UI. Use the same container and architecture; Docker needs ARM64 emulation on another architecture.

From the repository root, after installing dependencies for Linux ARM64, run:

```sh
docker run --rm --platform linux/arm64 --ipc=host \
  -v "$PWD:/work" -w /work \
  mcr.microsoft.com/playwright:v1.62.0-noble@sha256:baed2032d533817f3dbe6425de795788430ba345e819a1201337009ba17c9d07 \
  node node_modules/@playwright/test/cli.js test
```

If your host dependencies target another OS or architecture, use a separate checkout for container testing. Follow the repository setup procedure there: verify a locally available pnpm 12.21.0 executable, checkout-owned dependencies, and a compatible offline cache before an approved install. Do not invoke a downloader to provision pnpm automatically. If the executable or Linux cache is unavailable, obtain separate provisioning approval. This changes that checkout's `node_modules`; do not run it over shared dependencies or dependencies you need for macOS. Then run the comparison command. To run the fast suite in the container, use `node node_modules/vitest/vitest.mjs run --config vitest.browser.config.mjs`. Outside the container, browser tests require `pnpm exec playwright install --with-deps chromium`; visual results may differ.

To update intentional visual changes, append `--update-snapshots` to the container command. The equivalent local script is `pnpm run test:visual:update`. Review every changed PNG in `packages/*/test/real-ui/*-snapshots/`, then run comparisons twice without updating. Normal runs fail on missing or changed baselines and never create reference images.

The single-job GitHub Actions `Tests` workflow runs repository checks, unit tests, browser interactions, and real-host comparisons for PRs and pushes to `main`. It uses the same pinned container on `ubuntu-24.04-arm`; adding a plugin does not add a CI job. On failure, download `browser-failure-evidence` for actual/expected/diff images and browser diagnostics. `.vitest/`, `artifacts/browser/`, and `artifacts/real-ui/` are ignored by Git. CI never updates baselines.

To add a UI plugin, add its bundle to the `plugins` list in `tests/real-ui/global-setup.mjs`, then add specs under that package's `test/real-ui/` directory using the shared fixtures. The current suite uses one worker and one host, sequentially. Add separate profiles only when plugins require conflicting configurations. These tests cover the selected DSH version and UI paths, not all plugin combinations, full provider generation, or cross-version compatibility.

### Test dependency provenance

The test dependencies are exact-pinned development dependencies. The DSH launcher is pinned to `0.2.2-rc.5`; its official [DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness) identifies the `@deepseek-ai/dsh` package (MIT). The lockfile pins the complete runtime graph. DSH is still pre-1.0; upgrades require reviewing the host fixture and existing baselines. Regenerate baselines only for intentional, reviewed visual changes, not to conceal regressions. `@playwright/test` matches the existing official Playwright `1.62.0` package and container. [Vitest's official Browser Mode guide](https://vitest.dev/guide/browser/) identifies `vitest` and `@vitest/browser-playwright`; [Microsoft's Playwright documentation](https://playwright.dev/docs/intro) and [Docker guide](https://playwright.dev/docs/docker) identify Playwright and its official container. [React's integration guide](https://react.dev/learn/add-react-to-an-existing-project) identifies `react` and `react-dom`. React stays at 18.3.1 to match the plugin's host peer dependency.

Vitest and React use MIT licenses; Playwright uses Apache-2.0. Their canonical repositories are `vitest-dev/vitest`, `facebook/react`, and `microsoft/playwright`. These are actively maintained, widely adopted projects. The initial registry advisory check reports no vulnerabilities; this is not a guarantee against future advisories. Run `pnpm audit` when updating them.

Installs disable lifecycle scripts. Vitest's Vite dependency includes platform-specific Rolldown and Lightning CSS binaries distributed through npm; Chromium binaries come from the official Playwright container. Treat updates to these binaries and the container as dependency changes. Keep Playwright and the container version aligned, review the new digest and screenshots together, and preserve pnpm's release-age policy. GitHub Actions dependencies are pinned to commits from the official `actions` and `pnpm` repositories.

## Repository rules

- Keep credentials, API keys, sessions, databases, `.env` files, and DSH runtime state out of Git.
- Give inserted Cordis rows stable, scope-prefixed IDs.
- Pin compatibility-sensitive DSH dependencies while DSH remains pre-1.0.
- Keep host-wide services in profile bundles. Keep per-session tools, persona, and prompt composition in agent presets.
- Review `pnpm exec dsh --profile <name> --dump-config` using this checkout's patched launcher after changing bundle order or profile patches.
