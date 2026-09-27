# Shared OpenRouter credentials

This host plugin gives trusted integrations one shared OpenRouter credential. In **Plugins**, open the `@local/dsh-openrouter` bundle and select **Configure** for its `local-openrouter` row. It does not register a chat model or an agent tool, make remote requests, or copy keys into another store.

## Credential ownership

The plugin reuses the built-in `openrouter` route's DSH `llm-pi-ai` authentication sources, in this order:

1. An explicit `providers.openrouter.apiKeyEnv` credential reference. An unset explicit reference does not fall back to another key.
2. A populated API-key record at `llm-pi-ai/openrouter`.
3. The shared `OPENROUTER_API_KEY` credential reference, including DSH's launch-environment resolution.

When no credential exists, saving creates the canonical `llm-pi-ai/openrouter` record used by DSH's model settings. An existing reference remains a reference; the plugin does not copy it into a record. Unsupported record kinds and custom OpenRouter-route destinations fail closed. Custom provider aliases are not searched automatically.

Replacing or removing the key affects all consumers of that source, including DSH model calls. Read-only sources cannot be changed in the card. Removing a stored key can reveal a lower-priority environment key, so the card refreshes the effective status after removal. Saving checks local syntax only; it does not verify the key with OpenRouter.

Only install plugins you trust. DSH host plugins share credential access; this plugin is not a security boundary between plugins. Browser RPC exposes credential metadata, never stored key contents or suffixes. A newly entered key is sent to the host for storage and cleared from the input after saving. Ordinary plugin settings contain no key.

## Host service

Trusted host plugins can use:

```js
const status = await ctx.openrouter.status() // metadata only
const apiKey = await ctx.openrouter.resolveApiKey() // host-only secret
```

Consumers must keep the returned key on the host, send it only to their intended OpenRouter endpoint, and never log it. Resolution runs again on every call so key rotation takes effect without restarting. Settings RPC is limited to `status`, `save`, and `clear`; it does not expose arbitrary credential references or a general HTTP proxy.

## Packaging and validation

The bundle targets DSH `0.1.7-rc.2` and uses its existing credentials, settings, and connection services. It adds no OpenRouter SDK or other third-party runtime dependency beyond the repository's pinned DSH/schema packages. JavaScript ships directly, with no build step.

The `personal-web` recipe selects the bundle. Checking out or building this repository does not install it in a running profile. Profile application and restart require separate approval.

Host tests use synthetic credentials and real DSH Settings, ConfigEditor, and Loader services in a temporary profile. They verify live provider configuration, credential selection, trusted RPC registration, and disposal. Browser component tests use mocked transport. The real-shell settings test writes a fake key only inside the disposable test host, then removes it; it makes no OpenRouter request.

## Settings migration

DSH `0.1.7-rc.2` derives settings from active Loader entries instead of separately registered sections. This plugin has an empty Config and stores no ordinary preferences. Its custom page uses the `plugins.row.config` key `@local/dsh-openrouter#local-openrouter`; credential selection reads the live `llm-pi-ai` Config projection through `settings.describe()`.

An old `openrouter` section in `settings.yaml` does not match the `local-openrouter` entry and has no editable fields to import. DSH renames the legacy file to `settings.yaml.imported` before attempting section imports. That section is not a credential backup: keys remain in the existing credential store or credential reference. The record key `llm-pi-ai/openrouter` and reference names do not change.
