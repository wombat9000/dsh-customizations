# DSH customizations

This private repository keeps DSH plugin bundles and reproducible profile recipes for one user across several computers. Clone it on each computer, then apply the profiles you need. DSH keeps credentials, sessions, settings, and other runtime state outside this repository.

## Prerequisites

Install these tools before you use the repository:

- DSH, with the `dsh` command available on `PATH`
- Node.js 22.19 or newer
- pnpm 11.9

Set `DSH_HOME` before applying a profile if your Harness home is not `~/.dsh`.

## Apply the starter profile

The `personal-web` recipe selects the standard DSH base and Web bundles plus [Session Recap](packages/dsh-session-recap/README.md) and [Firecrawl](packages/dsh-web-firecrawl/README.md), targeting DSH `0.1.2-rc.1`. Configure the recap summary model in **Settings → Plugins → Plugin configuration → Session recap** and save your Firecrawl key in the collapsible **Firecrawl** card in that same list. Firecrawl replaces the profile's search/fetch providers; it requires a key before either web tool can run.

Existing installations require **one DSH Web restart** after applying this update so the host-side `web-firecrawl` settings registration discovers the card. Refresh the page afterward. Subsequent key changes take effect on the next request without a restart. Keys stay in DSH's credential store (or the launching environment), never in this repository.

1. Validate the repository:

   ```sh
   pnpm run check
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
   dsh --profile personal-web
   ```

The apply command adds every selected bundle in order. It does not remove bundles that are already installed but absent from the recipe.

## Repository structure

```text
packages/                    Installable plugin and composition bundles
profiles/<recipe>/           Ordered bundle selections and profile patches
schemas/                     Recipe schema for editor support
scripts/                     Dependency-free management commands
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

The apply script converts this path to an absolute local path before it calls `dsh plugin`. Each computer can therefore clone the repository at a different location.

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

Run the following commands after you pull changes:

```sh
git pull
pnpm run check
pnpm run apply -- personal-web
```

If a package needs a build step, run its workspace build before applying the profile. Restart a running DSH process after a host or client plugin changes.

## Run tests

Install dependencies with `pnpm install --frozen-lockfile --ignore-scripts`. Run repository checks with `pnpm run check` and the Node.js unit and host-integration tests with `pnpm test`.

### Browser interactions and real DSH screenshots

There are two browser suites:

- `pnpm run test:browser` runs fast Vitest Browser Mode interactions with real React and mocked RPC/slots. It checks generation, dismissal, errors, expansion, draft retention, and saving. Its simplified layout is **not** a visual baseline for DSH.
- `pnpm run test:visual` runs Playwright against **one disposable DSH 0.1.2-rc.1 instance for the whole suite**. It loads the real plugin bundles, global styles, themes, settings panel, and RPC transport. Screenshots cover collapsed/expanded plugin settings in light/dark mode alongside built-in cards, plus the recap dock and its unconfigured-provider error. Assertions also check that a new blank session hides the dock.

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

If your host dependencies target another OS or architecture, use a separate checkout for container testing. In that checkout, replace the final `node ...` line above with `npx --yes pnpm@11.9.0 install --frozen-lockfile --ignore-scripts` to install Linux dependencies first. This changes that checkout's `node_modules`; do not run it over dependencies you need for macOS. Then run the comparison command. To run the fast suite in the container, use `node node_modules/vitest/vitest.mjs run --config vitest.browser.config.mjs`. Outside the container, browser tests require `pnpm exec playwright install --with-deps chromium`; visual results may differ.

To update intentional visual changes, append `--update-snapshots` to the container command. The equivalent local script is `pnpm run test:visual:update`. Review every changed PNG in `packages/*/test/real-ui/*-snapshots/`, then run comparisons twice without updating. Normal runs fail on missing or changed baselines and never create reference images.

The single-job GitHub Actions `Tests` workflow runs repository checks, unit tests, browser interactions, and real-host comparisons for PRs and pushes to `main`. It uses the same pinned container on `ubuntu-24.04-arm`; adding a plugin does not add a CI job. On failure, download `browser-failure-evidence` for actual/expected/diff images and browser diagnostics. `.vitest/`, `artifacts/browser/`, and `artifacts/real-ui/` are ignored by Git. CI never updates baselines.

To add a UI plugin, add its bundle to the `plugins` list in `tests/real-ui/global-setup.mjs`, then add specs under that package's `test/real-ui/` directory using the shared fixtures. The current suite uses one worker and one host, sequentially. Add separate profiles only when plugins require conflicting configurations. These tests cover the selected DSH version and UI paths, not all plugin combinations, full provider generation, or cross-version compatibility.

### Test dependency provenance

The test dependencies are exact-pinned development dependencies. The DSH launcher is pinned to `0.1.2-rc.1`; its official [DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness) identifies the `@deepseek-ai/dsh` package (MIT). The lockfile pins the complete runtime graph. DSH is still pre-1.0; upgrades require reviewing the host fixture and regenerating baselines deliberately. `@playwright/test` matches the existing official Playwright `1.62.0` package and container. [Vitest's official Browser Mode guide](https://vitest.dev/guide/browser/) identifies `vitest` and `@vitest/browser-playwright`; [Microsoft's Playwright documentation](https://playwright.dev/docs/intro) and [Docker guide](https://playwright.dev/docs/docker) identify Playwright and its official container. [React's integration guide](https://react.dev/learn/add-react-to-an-existing-project) identifies `react` and `react-dom`. React stays at 18.3.1 to match the plugin's host peer dependency.

Vitest and React use MIT licenses; Playwright uses Apache-2.0. Their canonical repositories are `vitest-dev/vitest`, `facebook/react`, and `microsoft/playwright`. These are actively maintained, widely adopted projects. The initial registry advisory check reports no vulnerabilities; this is not a guarantee against future advisories. Run `pnpm audit` when updating them.

Installs disable lifecycle scripts. Vitest's Vite dependency includes platform-specific Rolldown and Lightning CSS binaries distributed through npm; Chromium binaries come from the official Playwright container. Treat updates to these binaries and the container as dependency changes. Keep Playwright and the container version aligned, review the new digest and screenshots together, and preserve pnpm's release-age policy. GitHub Actions dependencies are pinned to commits from the official `actions` and `pnpm` repositories.

## Repository rules

- Keep credentials, API keys, sessions, databases, `.env` files, and DSH runtime state out of Git.
- Give inserted Cordis rows stable, scope-prefixed IDs.
- Pin compatibility-sensitive DSH dependencies while DSH remains pre-1.0.
- Keep host-wide services in profile bundles. Keep per-session tools, persona, and prompt composition in agent presets.
- Review `dsh --profile <name> --dump-config` after changing bundle order or profile patches.
