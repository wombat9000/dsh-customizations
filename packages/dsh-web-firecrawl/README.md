# Local DSH Firecrawl Web Provider

Local DSH `0.1.2-rc.1` bundle that uses Firecrawl API v2 behind DSH's existing
`web_search` and `web_fetch` tools.

The package registers one provider (`firecrawl`) for both operations and adds a
**Plugins → Plugin configuration → Firecrawl** card to DSH Settings. It does not create competing
model-facing tool names. Search results and scraped pages therefore keep DSH's
standard schemas, prompt guidance, result cards, cancellation, and
provider-selection behavior.

## Install

From this repository's root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run check
pnpm run apply -- personal-web --dry-run
pnpm run apply -- personal-web
```

The recipe adds this bundle after DSH's base/Web bundles and Session Recap.
No build step, separate catalog entry, or deployment service is needed: the
workspace glob discovers the package and `dsh.bundle.patch` installs its host
and prebuilt client. The original `@local/dsh-web-firecrawl` package identity and
`local-web-firecrawl` row are retained so existing installations update in place.

To add only this bundle to another existing Web profile instead:

```sh
pnpm exec dsh plugin --profile web add ./packages/dsh-web-firecrawl
pnpm exec dsh --profile web --dump-config
```

Review the resolved config after applying: both providers should be `firecrawl`
and `tool-web` should enable search/fetch. A later profile patch replaces an
entire row's config, not individual fields.

Restart DSH Web after installation, open **Settings → Plugins → Plugin configuration**, and save the API
key in the collapsible Firecrawl card. No further restart is needed when the key changes.
When updating an existing installation to this card layout, restart DSH Web once
so its host-side plugin configuration registration is loaded, then refresh the page.

For a headless deployment, `FIRECRAWL_API_KEY` remains supported:

```sh
FIRECRAWL_API_KEY='fc-...' pnpm exec dsh web
```

The bundle selects `firecrawl` as both the search and fetch provider and enables
DSH's existing `web_fetch` tool.

## Configuration

The provider accepts these optional Cordis config values:

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | unset | Legacy literal override; takes precedence over credential references. Do not commit it. |
| `baseURL` | `https://api.firecrawl.dev/v2` | HTTPS API base URL, including `/v2`. |
| `maxBodyChars` | `100000` | Maximum markdown characters returned by one scrape. |
| `search` | `true` | Register the Firecrawl search provider. |
| `fetch` | `true` | Register the Firecrawl fetch provider. |

Example self-hosted override in a later profile patch:

```yaml
- id: local-web-firecrawl
  config:
    baseURL: https://firecrawl.example.com/v2
    maxBodyChars: 150000
```

Prefer the credential reference or launch environment, not `apiKey`. A literal
`apiKey` overrides even a key saved through the card; remove that override and
restart DSH Web before managing the key through Settings. Never put a key in a
committed patch. Only use a trusted `baseURL`: it receives the bearer credential.
`maxBodyChars` limits returned markdown, not the HTTP response download size.

## Credential security

The Settings card uses DSH's existing loopback-only credential API. The browser
sends a new key only on save; the Host returns only `configured`, `source`, and
`writable` status. Managed keys are not read back into browser state or placed in
settings documents, plugin inventory, sessions, or tool arguments. Treat provider
error text as untrusted; upstream error messages may be surfaced in tool results.
With no literal override, the provider resolves the fixed `FIRECRAWL_API_KEY` credential reference through
`ctx.credentials` at the beginning of every search or fetch, so a saved or
rotated key is used by the next operation without a restart. A process-
environment key is read-only and takes precedence over the managed store.

## Mapping

- Search calls `POST /v2/search` with the DSH query and result limit, then maps
  Firecrawl's web results to DSH sources (`url`, `title`, and `snippet`).
- Fetch calls `POST /v2/scrape` requesting markdown, then maps the final URL,
  target status code, markdown body, and truncation state to DSH's fetch result.
- Firecrawl API/network failures become DSH `WebError` values. Cancellation is
  forwarded through the request `AbortSignal`.

Advanced Firecrawl operations such as crawl, map, structured extraction, and
browser interaction are intentionally not exposed here. They require separate
model-facing tools because they do not fit DSH's provider-neutral search/fetch
contract.

## Test

```sh
pnpm --filter @local/dsh-web-firecrawl test
```

The 34 imported unit tests use mocked HTTP responses and do not consume Firecrawl
credits. Run `pnpm --filter @local/dsh-web-firecrawl test:integration` for repository
manifest/recipe/dry-run checks; the original standalone Web-server smoke test is
adapted to this repository so it does not create another home, profile, or server.
`pnpm test` includes both suites. `pnpm run test:browser` also discovers this
package's real React interactions with mocked credential RPCs.

The client explicitly injects `slots`, `remote`, and **`remote.credentials`** and
uses `ctx.remote.credentials.describe([ref])`, `set(ref, value)`, and `unset(ref)`.
Responses use `{ ok, value/error }`, never `response.result`. The
`settings.plugin.item` slot key and the host's empty settings namespace are both
`web-firecrawl`: both registrations are required for configuration-list discovery.
Secrets are edited only through the credential API, never the empty settings section.

Real-host visual coverage is deferred: the existing shared DSH fixture and Recap
baselines are unchanged. Adding this card to that fixture requires reviewing and
regenerating affected Linux ARM64 settings screenshots together. No sandbox or
running DSH installation needs to be recreated for this import's unit, dry-run,
and mocked-browser checks. The source installation was user-verified for credential
configuration and a subsequent live search; those live checks are not repeated here.
