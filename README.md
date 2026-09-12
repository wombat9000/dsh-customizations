# DSH customizations

This private repository keeps DSH plugin bundles and reproducible profile recipes for one user across several computers. Clone it on each computer, then apply the profiles you need. DSH keeps credentials, sessions, settings, and other runtime state outside this repository.

## Prerequisites

Install these tools before you use the repository:

- The checkout-local, patched DSH `0.1.5-rc.1` launcher installed by the frozen dependency command below (a global DSH installation is not upgraded or used by `apply`)
- Node.js `^22.19.0 || >=24.0.0`
- pnpm 11.9.0, already available locally (not an unverified downloader shim)

Before dependency work in any checkout or worktree, follow the [repository setup skill](.agents/skills/repository-setup/SKILL.md). It covers dependency ownership, pinned executable availability, offline cache limitations, and approval boundaries. You can read this Markdown directly without a plugin.

Set `DSH_HOME` before applying a profile if your Harness home is not `~/.dsh`.

## Apply the starter profile

The `personal-web` recipe selects the standard DSH base and Web bundles plus [Session Environment](packages/dsh-session-environment/README.md), [Session Recap](packages/dsh-session-recap/README.md), [Worktree workers](packages/dsh-worktree/README.md), [Project Steward](packages/dsh-project-steward/README.md), [Firecrawl](packages/dsh-web-firecrawl/README.md), [Google auth](packages/dsh-google-auth/README.md), [Google Drive](packages/dsh-google-drive/README.md), [GitHub](packages/dsh-github/README.md), [Linear](packages/dsh-linear/README.md), [YouTube](packages/dsh-tool-youtube/README.md), and [Trivy](packages/dsh-tool-trivy/README.md), targeting DSH `0.1.5-rc.1`. Configure the recap summary model in **Settings → Plugins → Plugin configuration → Session recap** and save your Firecrawl key in the collapsible **Firecrawl** card in that same list. Firecrawl replaces the profile's search/fetch providers; it requires a key before either web tool can run.

Existing installations require **one DSH Web restart** after applying this update so the host-side `web-firecrawl` settings registration discovers the card. Refresh the page afterward. Subsequent key changes take effect on the next request without a restart. Keys stay in DSH's credential store (or the launching environment), never in this repository.

1. After the setup procedure's ownership, executable, cache, and approval checks, install dependencies, validate the repository, and build Session Environment. If the offline install fails, stop; obtain separate approval for cache population rather than retrying online:

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

**Required RC compatibility patch:** this repository pins the [RPC-owner fix](patches/dsh-client-connection-0.1.5-rc.1-rpc-owner.patch) through pnpm 11's `patchedDependencies` in `pnpm-workspace.yaml` and the lockfile. `apply` verifies the checkout-local launcher and patched Connection implementation before writing the profile, then copies the patch into the target profile, preserves its workspace YAML settings (with a `.bak` backup), and pins DSH bundle/transitive versions with exact release-age exceptions, and resolves the complete profile graph offline with lifecycle scripts disabled. Conflicting target-version overrides are refused. It finishes with a frozen offline install, verifies the profile's own patched Web/Connection graph, and dumps its configuration. Missing cache entries are a hard failure, never an automatic online retry. Review any partial profile changes after an install failure; application is not transactional.

Other launchers, including global `dsh`, are deliberately unsupported by `apply`; `DSH_BIN` may only name this checkout's `node_modules/.bin/dsh`. Keep this checkout at a durable path when using its launcher. No global package, running process, credentials, or history is modified automatically. Restart through your usual service mechanism only after explicitly selecting the patched launcher. For a separately managed launcher, carry the same patch in that runtime's independent dependency graph and validate it separately. See [migration steps and limits](MIGRATION-0.1.5-rc.1.md), including existing preset/history cautions.

Worktree workers bundles the **Worktree coordinator** agent preset with its host service. After updating and restarting the profile, select it for a new session to use worktree tools alongside Standard's coding and job tools. For the stock Web profile, installation keeps Standard as the default and preserves saved default IDs. Before installing, check the [preset-ID collision and custom-roster prerequisites](packages/dsh-worktree/README.md#install-and-select-the-preset): these can affect which preset a saved ID resolves to. No shipped preset files or running sessions are modified.

Project Steward bundles a separate **Project Steward** preset for repository setup and guidance audits. It retains Standard's tools, proposes changes before writing, and carries optional versioned templates. The personal-web profile patch retains both custom preset roots because bundle patches replace the entire roster configuration. Inspect [Project Steward's installation prerequisites](packages/dsh-project-steward/README.md#install-and-select) for ID collisions and custom roots. Selecting it performs no setup writes or installs.

Google auth provides the shared **Google accounts** Settings card, client configuration, explicit consent, and token refresh. Google Drive adds a default-off **Google Drive** toggle in each top-level session's toolbar. With any preset, enabling it exposes `request_drive_access` and `request_sheets_edit_access` without granting file access. Its custom picker grants session-scoped reading or separate individual-spreadsheet editing access. Read grants expose listing, text-reading, and bounded Sheets range tools. Sheets edits require a local before/after preview and exact **Apply changes** approval. Use **Manage access** to revise or revoke a selection, or turn the toolbar toggle off to revoke both selections and remove all Google tools. Disabling cannot undo writes already sent. Google Drive ships no agent preset and does not replace the preset roster; use the toolbar toggle with any remaining preset. After an approved profile update and restart, choose **Connect Google account** in **Settings → Plugins → Google accounts**. One OAuth flow requests all currently enabled integration scopes, including Drive reading and account-wide Sheets editing. Existing connections missing scopes use the single **Grant additional permissions** action. Credentials stay in DSH's credential store. Grants expire on session unload, account changes, or Host restart, and do not transfer to subagents. The stock Standard preset stays unchanged. Enable the Sheets API for spreadsheet reads. Combined account consent does not grant session access or approve writes; DSH enforces the selected-file restriction and per-write approval. This version includes no Gmail/GCP tools, general Drive file mutations, or `gws` execution. See the [shared auth contract](packages/dsh-google-auth/README.md) and [Drive setup and security boundary](packages/dsh-google-drive/README.md).

### GitHub

[GitHub](packages/dsh-github/README.md) adds eleven preset-neutral read tools and seven individually approved write tools to all sessions when its host bundle is loaded. Tools use the existing `gh` authentication in DSH’s managed subprocess backend; a sandbox CLI login does not establish that an unmanaged host process sees the same account. The plugin never installs `gh`, starts a login flow, or copies tokens into DSH settings.

Use `github_connection_status` to check the effective account, then `github_detect_repositories` to inspect the calling session’s Git remotes. Discovery returns candidates, not a saved selection or access restriction. Repository- and owner-scoped tools require explicit targets. The connected account’s permissions determine accessible resources. GitHub text is untrusted reference material. Write tools show exact per-call approval previews, create projects/issues, update project text, link repositories/items, set supported field values, and add native blocking dependencies. Denied or unavailable approval dispatches no mutation. If a dispatched write has an uncertain outcome, inspect GitHub before deciding whether to try again; there is no automatic mutation retry, rollback, or durable recovery ledger. The integration adds no preset, settings UI, or session-level repository policy.

The recipe selects the GitHub bundle, but source changes do not update a running profile. Applying the profile and restarting DSH require separate approval. No GitHub SDK or other dependency is added.

### Linear, YouTube, and Trivy

These bundles are maintained in this repository and selected by `personal-web`. Adding them to the recipe does not update a running profile; follow the approved apply and restart procedure above.

- **Linear:** Open **Settings → Plugins → Plugin configuration → Linear** and connect a workspace. The collapsible card replaces the separate Linear sidebar entry. Read tools use the bound workspace; project writes require one-shot approval. Existing credential and settings namespaces remain unchanged.
- **YouTube:** Configure the Gemini API key in **Settings → YouTube**. Video analysis and transcript generation send public YouTube URLs and questions to Gemini and can incur provider charges. Transcript read/search tools reuse the host-wide SQLite archive. The archive provider ships inside the YouTube bundle as a separate host row; no companion workspace package is needed.
- **Trivy:** Open **Settings → Trivy** to check CLI availability. Scans require a separately installed Trivy executable on DSH's effective `PATH`; the plugin never installs it. A real scan can download vulnerability databases. Tests use subprocess fixtures rather than running Trivy.

The YouTube archive keeps the `local-youtube-transcript-store` row ID and `archives/youtube-transcripts.sqlite` path under `DSH_HOME`. If an existing profile installed the old standalone `@local/dsh-youtube-transcript-store` package, review its composition before migration and retain only one archive-provider row. Profile application does not remove old packages automatically. No archive, credential, session, or preset migration runs when you check out this repository.

Linear pins the official [Linear SDK](https://linear.app/developers/sdk) at `92.0.0` (MIT). YouTube pins Google's official [Gen AI SDK](https://ai.google.dev/gemini-api/docs/libraries) at `2.21.0` (Apache-2.0). Both versions match the imported source lockfile. Installs disable lifecycle scripts; no Trivy binary or additional database driver is bundled. The archive uses Node.js's built-in SQLite API. GitHub's advisory lookup returned no matching advisories for those two direct SDK versions during import; this is not a full dependency audit or a guarantee of safety.

## Repository structure

```text
packages/                    Installable plugin and composition bundles
profiles/<recipe>/           Ordered bundle selections and profile patches
schemas/                     Recipe schema for editor support
scripts/                     Management commands (dry-run/check need no dependencies)
patches/                     Exact-version required DSH compatibility patches
templates/plugin-bundle/     Starter package to copy
```

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

## Update another computer

After pulling changes, repeat the setup procedure's executable, ownership, cache, and approval checks before installing. The commands below do not authorize installs or profile changes:

```sh
git pull
pnpm install --offline --frozen-lockfile --ignore-scripts
pnpm run check
pnpm run build
pnpm run apply -- personal-web
```

If a package needs a build step, run its workspace build before applying the profile. Restart a running DSH process after a host or client plugin changes.

## Run tests

If dependencies are missing, follow the [repository setup skill](.agents/skills/repository-setup/SKILL.md) before an approved offline install. Run repository checks with `pnpm run check` and the Node.js unit and host-integration tests with `pnpm test`. The test command first runs `pnpm run build`, which type-checks and bundles Session Environment's TypeScript host and client. Its integration tests validate recipe wiring and generated entrypoints without starting DSH; the browser suites below do not yet cover the Environment card.

### Browser interactions and real DSH screenshots

There are two browser suites:

- `pnpm run test:browser` runs fast Vitest Browser Mode interactions with real React and mocked RPC/slots. It checks generation, dismissal, errors, expansion, draft retention, and saving. Its simplified layout is **not** a visual baseline for DSH.
- `pnpm run test:visual` runs Playwright against **one disposable DSH 0.1.5-rc.1 instance for the whole suite**. It loads the real plugin bundles, global styles, themes, settings panel, and RPC transport. Screenshots cover collapsed/expanded plugin settings in light/dark mode alongside built-in cards, plus the recap dock and its unconfigured-provider error. Assertions also check that a new blank session hides the dock. Worktrees screenshots cover light, dark, and narrow slot layouts in the real shell with fixed RPC data; they test appearance, not backend capability or Git behavior. Their committed baselines use `toHaveScreenshot`, so changes produce expected/actual/diff images under `artifacts/real-ui/`, uploaded by the existing CI failure-artifact step.

The host uses unique temporary home, profile, and workspace directories. It receives an allowlisted environment without your provider credentials or DSH settings. A test-only host plugin seeds and flushes a completed user turn through DSH's session store; no prompt or provider request creates the fixture. The suite never configures a provider, submits a prompt, or calls a paid model. It authenticates through DSH's normal launch-token exchange outside Playwright, then uses only a cookie and tokenless URL. It does not read or modify a running DSH instance. Teardown terminates the host process group and removes its temporary state; lifecycle tests cover startup failures and descendant cleanup. Abrupt container or machine termination relies on the container/OS cleanup boundary.

Every test gets a fresh browser context. Each settings test explicitly selects its theme through the real General settings UI. Settings persist on the shared host, so new tests that change other settings must restore them. Traces and video are disabled to avoid recording authentication state. Browser requests outside the disposable host are blocked.

The PNG baselines use **Linux ARM64**, the digest-pinned Playwright 1.62.0 Ubuntu Noble image below, and its Chromium/fonts. Viewport, scale, locale, time zone, and fixture content are fixed. Comparisons use zero allowed pixel differences and zero color threshold. DSH uses system fonts, so these are Linux baselines, not pixel-identical copies of a Mac UI. Use the same container and architecture; Docker needs ARM64 emulation on another architecture.

From the repository root, after installing dependencies for Linux ARM64, run:

```sh
docker run --rm --platform linux/arm64 --ipc=host \
  -v "$PWD:/work" -w /work \
  mcr.microsoft.com/playwright:v1.62.0-noble@sha256:baed2032d533817f3dbe6425de795788430ba345e819a1201337009ba17c9d07 \
  node node_modules/@playwright/test/cli.js test
```

If your host dependencies target another OS or architecture, use a separate checkout for container testing. Follow the repository setup procedure there: verify a locally available pnpm 11.9.0 executable, checkout-owned dependencies, and a compatible offline cache before an approved install. Do not invoke a downloader to provision pnpm automatically. If the executable or Linux cache is unavailable, obtain separate provisioning approval. This changes that checkout's `node_modules`; do not run it over shared dependencies or dependencies you need for macOS. Then run the comparison command. To run the fast suite in the container, use `node node_modules/vitest/vitest.mjs run --config vitest.browser.config.mjs`. Outside the container, browser tests require `pnpm exec playwright install --with-deps chromium`; visual results may differ.

To update intentional visual changes, append `--update-snapshots` to the container command. The equivalent local script is `pnpm run test:visual:update`. Review every changed PNG in `packages/*/test/real-ui/*-snapshots/`, then run comparisons twice without updating. Normal runs fail on missing or changed baselines and never create reference images.

The single-job GitHub Actions `Tests` workflow runs repository checks, unit tests, browser interactions, and real-host comparisons for PRs and pushes to `main`. It uses the same pinned container on `ubuntu-24.04-arm`; adding a plugin does not add a CI job. On failure, download `browser-failure-evidence` for actual/expected/diff images and browser diagnostics. `.vitest/`, `artifacts/browser/`, and `artifacts/real-ui/` are ignored by Git. CI never updates baselines.

To add a UI plugin, add its bundle to the `plugins` list in `tests/real-ui/global-setup.mjs`, then add specs under that package's `test/real-ui/` directory using the shared fixtures. The current suite uses one worker and one host, sequentially. Add separate profiles only when plugins require conflicting configurations. These tests cover the selected DSH version and UI paths, not all plugin combinations, full provider generation, or cross-version compatibility.

### Test dependency provenance

The test dependencies are exact-pinned development dependencies. The DSH launcher is pinned to `0.1.5-rc.1`; its official [DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness) identifies the `@deepseek-ai/dsh` package (MIT). The lockfile pins the complete runtime graph. DSH is still pre-1.0; upgrades require reviewing the host fixture and regenerating baselines deliberately. `@playwright/test` matches the existing official Playwright `1.62.0` package and container. [Vitest's official Browser Mode guide](https://vitest.dev/guide/browser/) identifies `vitest` and `@vitest/browser-playwright`; [Microsoft's Playwright documentation](https://playwright.dev/docs/intro) and [Docker guide](https://playwright.dev/docs/docker) identify Playwright and its official container. [React's integration guide](https://react.dev/learn/add-react-to-an-existing-project) identifies `react` and `react-dom`. React stays at 18.3.1 to match the plugin's host peer dependency.

Vitest and React use MIT licenses; Playwright uses Apache-2.0. Their canonical repositories are `vitest-dev/vitest`, `facebook/react`, and `microsoft/playwright`. These are actively maintained, widely adopted projects. The initial registry advisory check reports no vulnerabilities; this is not a guarantee against future advisories. Run `pnpm audit` when updating them.

Installs disable lifecycle scripts. Vitest's Vite dependency includes platform-specific Rolldown and Lightning CSS binaries distributed through npm; Chromium binaries come from the official Playwright container. Treat updates to these binaries and the container as dependency changes. Keep Playwright and the container version aligned, review the new digest and screenshots together, and preserve pnpm's release-age policy. GitHub Actions dependencies are pinned to commits from the official `actions` and `pnpm` repositories.

## Repository rules

- Keep credentials, API keys, sessions, databases, `.env` files, and DSH runtime state out of Git.
- Give inserted Cordis rows stable, scope-prefixed IDs.
- Pin compatibility-sensitive DSH dependencies while DSH remains pre-1.0.
- Keep host-wide services in profile bundles. Keep per-session tools, persona, and prompt composition in agent presets.
- Review `pnpm exec dsh --profile <name> --dump-config` using this checkout's patched launcher after changing bundle order or profile patches.
