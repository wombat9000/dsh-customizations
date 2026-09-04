# Packages

Put installable DSH customization packages in this directory. Each direct child is a pnpm workspace package.

A package that users add to a profile must declare a bundle patch:

```json
{
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

Copy `templates/plugin-bundle` when you start a package. Rename its package, plugin row, and source files before adding it to a profile recipe.
