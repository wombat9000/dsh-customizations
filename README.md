# DSH customizations

This private repository keeps DSH plugin bundles and reproducible profile recipes for one user across several computers. Clone it on each computer, then apply the profiles you need. DSH keeps credentials, sessions, settings, and other runtime state outside this repository.

## Prerequisites

Install these tools before you use the repository:

- DSH, with the `dsh` command available on `PATH`
- Node.js 22.19 or newer
- pnpm 11.9

Set `DSH_HOME` before applying a profile if your Harness home is not `~/.dsh`.

## Apply the starter profile

The `personal-web` recipe selects the standard DSH base and Web bundles plus [Session Recap](packages/dsh-session-recap/README.md). Configure its summary model in **Settings → Plugins → Plugin configuration → Session recap** before use.

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

### Browser screenshots

`pnpm run test:browser` runs Vitest Browser Mode with real React 18 and Chromium. The harness loads the production `client.js`, calls `apply`, and renders the registered slot components. Only the module loader, slot host, and RPC are fixtures. The screenshots cover blank and nonblank conversations, a generated recap, collapsed and expanded settings, narrow settings, and a narrow dark recap error. Interaction assertions cover generation, dismissal, expansion, draft retention, and saving.

These tests do not start DSH or contact a model provider. They do not test real-host activation, transport, persistence, application-shell styling, or the live Web GUI. The dark and narrow layouts are slot fixtures, not full-app themes or mobile emulation.

The checked-in PNG baselines use **Linux ARM64**, the digest-pinned Playwright 1.62.0 Ubuntu Noble image below, and its Chromium and fonts. The harness fixes viewport, scale, locale, time zone, motion, fixture data, and displayed timestamp. Comparisons allow no mismatched pixels, including antialiasing differences. Use the same container and architecture to avoid platform-dependent failures. On another architecture, Docker needs ARM64 emulation.

From the repository root, after installing dependencies for Linux ARM64, run:

```sh
docker run --rm --platform linux/arm64 --ipc=host \
  -v "$PWD:/work" -w /work \
  mcr.microsoft.com/playwright:v1.62.0-noble@sha256:baed2032d533817f3dbe6425de795788430ba345e819a1201337009ba17c9d07 \
  node node_modules/vitest/vitest.mjs run --config vitest.browser.config.mjs
```

If your host dependencies target another OS or architecture, use a separate checkout for container testing. In that checkout, replace the final `node ...` line above with `npx --yes pnpm@11.9.0 install --frozen-lockfile --ignore-scripts` to install Linux dependencies first. This changes that checkout's `node_modules`; do not run it over dependencies you need for macOS. Then run the comparison command. A local run outside the container requires `pnpm exec playwright install --with-deps chromium`, but its screenshots might differ from the canonical baselines.

To update intentional visual changes, append `--update` to the container command. The equivalent local script is `pnpm run test:browser:update`. Review every changed PNG in `packages/dsh-session-recap/test/browser/__screenshots__/` before including it in a change. Then run the comparison command twice without `--update`. Normal runs fail on missing or changed baselines and never create them.

The GitHub Actions `Tests` workflow runs checks, unit tests, and browser comparisons for pull requests and pushes to `main`. It uses the same pinned container on `ubuntu-24.04-arm`. On failure, download the `browser-failure-evidence` artifact for screenshots and visual diffs. Diagnostic output under `.vitest/` and `artifacts/browser/` is ignored by Git. CI never updates baselines.

### Test dependency provenance

The test dependencies are exact-pinned development dependencies. [Vitest's official Browser Mode guide](https://vitest.dev/guide/browser/) identifies `vitest` and `@vitest/browser-playwright`; [Microsoft's Playwright documentation](https://playwright.dev/docs/intro) and [Docker guide](https://playwright.dev/docs/docker) identify Playwright and its official container. [React's integration guide](https://react.dev/learn/add-react-to-an-existing-project) identifies `react` and `react-dom`. React stays at 18.3.1 to match the plugin's host peer dependency.

Vitest and React use MIT licenses; Playwright uses Apache-2.0. Their canonical repositories are `vitest-dev/vitest`, `facebook/react`, and `microsoft/playwright`. These are actively maintained, widely adopted projects. The initial registry advisory check reports no vulnerabilities; this is not a guarantee against future advisories. Run `pnpm audit` when updating them.

Installs disable lifecycle scripts. Vitest's Vite dependency includes platform-specific Rolldown and Lightning CSS binaries distributed through npm; Chromium binaries come from the official Playwright container. Treat updates to these binaries and the container as dependency changes. Keep Playwright and the container version aligned, review the new digest and screenshots together, and preserve pnpm's release-age policy. GitHub Actions dependencies are pinned to commits from the official `actions` and `pnpm` repositories.

## Repository rules

- Keep credentials, API keys, sessions, databases, `.env` files, and DSH runtime state out of Git.
- Give inserted Cordis rows stable, scope-prefixed IDs.
- Pin compatibility-sensitive DSH dependencies while DSH remains pre-1.0.
- Keep host-wide services in profile bundles. Keep per-session tools, persona, and prompt composition in agent presets.
- Review `dsh --profile <name> --dump-config` after changing bundle order or profile patches.
