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

## Repository rules

- Keep credentials, API keys, sessions, databases, `.env` files, and DSH runtime state out of Git.
- Give inserted Cordis rows stable, scope-prefixed IDs.
- Pin compatibility-sensitive DSH dependencies while DSH remains pre-1.0.
- Keep host-wide services in profile bundles. Keep per-session tools, persona, and prompt composition in agent presets.
- Review `dsh --profile <name> --dump-config` after changing bundle order or profile patches.
