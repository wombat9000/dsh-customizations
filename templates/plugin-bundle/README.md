# Example DSH plugin bundle

Copy this directory into `packages/` and rename all `your-scope` and `example` placeholders.

The package contains two related parts:

- `src/index.js` implements the runtime plugin.
- `cordis.patch.yml` mounts that plugin when a profile selects this package as a bundle.

Add the resulting package to a profile recipe with a path relative to the recipe directory. For example:

```json
{
  "name": "@your-scope/dsh-example",
  "source": "../../packages/dsh-example"
}
```
