# DSH Gemini Image Generation

A Gemini-backed `generate_image` tool for DSH. It reuses the shared `GEMINI_API_KEY` credential used by the YouTube tools; it intentionally does not create a second API-key setting.

## Install

The `personal-web` recipe selects this bundle after YouTube. Follow the repository's [setup and approved apply procedure](../../README.md#apply-the-starter-profile); the checkout-local launcher and each separate profile graph must retain the RC2 RPC-owner patch. Merely pulling this source does not install it or restart any instance.

After an explicitly approved profile update, restart through your normal service mechanism and reload the browser. Configure the shared key in **Settings → Plugins → Plugin configuration → YouTube**. Headless deployments can export `GEMINI_API_KEY` instead. Imagegen has no separate credentials/settings card and does not require the YouTube runtime when the credential is otherwise available.

This imports `@local/dsh-tool-imagegen` from the local `dsh` repository without changing its host/client implementation or composition row `local-tool-imagegen`. Existing deployments must switch that package's source, not load another copy or another `generate_image` provider. Removing the old local implementation and adopting this source in host/sandbox deployments are separate tasks. The Google Gen AI SDK is exact-pinned to `2.21.0`, matching the existing YouTube bundle and normal lockfile; all DSH contracts are native RC2.

## Tool

The model receives one tool:

    {
      "prompt": "A clean editorial illustration of a small cabin under the northern lights",
      "aspectRatio": "16:9",
      "imageSize": "1K"
    }

The default model is `gemini-3.1-flash-image`. The provider response is decoded and saved through DSH's durable attachment store; provider URLs and base64 never enter the session result. The tool returns durable image references and emits image content blocks for the model/tool pipeline. Its Web client registers a `generate_image` Tool view that loads those references through the active session, displays bounded previews, and opens the full image in a lightbox.

## Configuration

| Key              |                  Default | Meaning                                                      |
| ---------------- | -----------------------: | ------------------------------------------------------------ |
| `model`          | `gemini-3.1-flash-image` | Gemini image-capable model.                                  |
| `timeoutMs`      |                 `180000` | Cooperative request timeout in milliseconds.                 |
| `maxPromptChars` |                   `8000` | Maximum prompt length.                                       |
| `maxImages`      |                      `4` | Maximum requested candidates per call.                       |
| `generate`       |                   `true` | Register `generate_image`.                                   |
| `apiKey`         |                    unset | Secret literal override; prefer the shared `GEMINI_API_KEY`. |

Supported tool values are aspect ratios `1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `9:16`, `16:9`, and `21:9`; image sizes are `1K`, `2K`, and `4K`.

## Security and limitations

- Generation sends the prompt and image options to Gemini and can incur charges. The tool instruction requires an explicit user request for an image/visual asset; generated content is untrusted. This import preserves existing behavior and adds no new one-shot approval dialog or automatic retry. Use appropriate DSH policy controls and conservative image-count/size limits.
- The local attachment backend retains generated objects until reference-aware garbage collection exists.
- This MVP supports text-to-image. Reference-image editing can use the existing durable image substrate in a follow-up tool without changing the credential seam.
- Gemini image models may return text alongside an image; text is retained as provider metadata but the tool always supplies its own bounded result summary.

References: [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation) and [Google Gen AI SDK](https://github.com/googleapis/js-genai).

## Development and tests

Maintained host modules live in [src](src/index.ts). The modular Web client lives in [client](client/index.ts), with the native attachment-read contract in [shared/contracts.ts](shared/contracts.ts). Strict checking enables `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Package entrypoints and legacy host subpaths resolve to generated ESM under `dist/src`; the lazy Web loader retains `@local/dsh-tool-imagegen` and its named exports.

After the repository's approved dependency setup, run these commands from the repository root:

```sh
node packages/dsh-tool-imagegen/scripts/typecheck.mjs
node packages/dsh-tool-imagegen/scripts/build-host.mjs
node packages/dsh-tool-imagegen/scripts/build-client.mjs
node packages/dsh-tool-imagegen/scripts/build-host.mjs --check
node packages/dsh-tool-imagegen/scripts/build-client.mjs --check
node --test packages/dsh-tool-imagegen/test/*.test.js
node node_modules/vitest/vitest.mjs run --config packages/dsh-tool-imagegen/vitest.config.mjs --configLoader native
```

The normal Node suite checks strict source contracts and host/client artifact freshness without rewriting outputs. The package also exposes `build`, `build:host`, `build:client`, `typecheck`, `test`, `test:integration`, and `test:browser` scripts. Regenerate and include both host and client artifacts after source changes; never edit generated JavaScript directly.

Tests use fixture provider responses and attachment reads. They make no Gemini requests and consume no credits. The integration suite checks recipe/manifest composition, apply dry-run, and shared credential rotation; it neither installs a profile nor generates images. Browser tests use real React/DOM to check previews, lightbox interaction, retry, data-URL fallback, stale responses, and object-URL cleanup. The package-local Vitest configuration keeps caches and failure screenshots in `.vitest/`; native config loading avoids writes into borrowed `node_modules`.

The existing `node tests/real-ui/migration-boot.mjs` checks all recipe bundles in a disposable Loader/Web host without provider requests. Source and component tests do not prove native slot election or real-shell layout. Running that shared smoke test, applying a production profile, restarting DSH, and calling the provider remain separate validation or deployment steps.
