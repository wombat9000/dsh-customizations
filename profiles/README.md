# Profile recipes

Each directory contains the desired bundles and patch for one machine-local DSH profile.

- `recipe.json` selects an ordered bundle list and names the target profile.
- `cordis.patch.yml` contains machine-independent overrides applied after all bundles.
- The apply script resolves relative bundle sources from the recipe directory.

Run `pnpm run apply -- <recipe-directory>` to apply a recipe. The script does not remove bundles that are already installed but absent from the recipe.
