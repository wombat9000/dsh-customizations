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

## Test

Mocked tests do not call Gemini or consume credits:

    pnpm --filter @local/dsh-tool-imagegen test
    pnpm --filter @local/dsh-tool-imagegen test:integration

The integration command checks recipe/manifest composition and apply dry-run only; it neither installs a profile nor generates images. After the approved dependency install and build, `node tests/real-ui/migration-boot.mjs` exercises all recipe bundles in a disposable real Loader/Web host without provider requests. No imagegen build step is needed (plain JavaScript).

Import validation on macOS ARM64 / Node.js 24.18.0 / pnpm 11.9.0: 15 focused tests passed; full build/unit suite passed (1,137 passed, eight existing native-PDF/platform skips); recipe check, clean peers, frozen offline reinstall and thirteen-bundle Loader/Web/authenticated shell/read-only RPC smoke passed. The first offline install lacked cached test packages; an authorized frozen scripts-disabled install fetched those, without changing any existing lock resolution. No image-generation provider request, browser/visual suite, production profile apply or deployment was performed. Runtime/client/patch bytes and original unit/client tests match the imported source; the old install-and-boot test is replaced by safe recipe checks plus the shared disposable-host smoke.
