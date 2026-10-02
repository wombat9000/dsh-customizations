# Local DSH Firecrawl Web Provider

Local DSH `0.1.7-rc.2` bundle that uses Firecrawl API v2 behind DSH's existing
`web_search` and `web_fetch` tools.

The package registers one provider (`firecrawl`) for both operations and adds a
credential configuration page under **Plugins → Firecrawl → Configure**. It does not create competing
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
The workspace glob discovers the package and `dsh.bundle.patch` installs its generated host
and prebuilt client. Committed artifacts need no build during installation; rebuild them
before applying a profile if you edit the TypeScript sources. The original `@local/dsh-web-firecrawl` package identity and
`local-web-firecrawl` row are retained so existing installations update in place.

To add only this bundle to another existing Web profile instead:

```sh
pnpm exec dsh plugin --profile web add ./packages/dsh-web-firecrawl
pnpm exec dsh --profile web --dump-config
```

Review the resolved config after applying: both providers should be `firecrawl`
and `tool-web` should enable search/fetch. A later profile patch replaces an
entire row's config, not individual fields.

After an approved installation or profile update, restart the existing DSH Web process
and refresh its URL. Open **Plugins**, select the Firecrawl bundle, and choose
**Configure** for its Firecrawl row to save the API key. No further restart is
needed when the key changes.

For a headless deployment, `FIRECRAWL_API_KEY` remains supported:

```sh
FIRECRAWL_API_KEY='fc-...' pnpm exec dsh web
```

The bundle selects `firecrawl` as both the search and fetch provider and enables
DSH's existing `web_fetch` tool.

## Configuration

The provider accepts these optional Cordis config values:

| Key            | Default                        | Meaning                                                                                 |
| -------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| `apiKey`       | unset                          | Legacy literal override; takes precedence over credential references. Do not commit it. |
| `baseURL`      | `https://api.firecrawl.dev/v2` | HTTPS API base URL, including `/v2`.                                                    |
| `maxBodyChars` | `100000`                       | Maximum markdown characters returned by one scrape.                                     |
| `search`       | `true`                         | Register the Firecrawl search provider.                                                 |
| `fetch`        | `true`                         | Register the Firecrawl fetch provider.                                                  |

Example self-hosted override in a later profile patch:

```yaml
- id: local-web-firecrawl
  config:
    baseURL: https://firecrawl.example.com/v2
    maxBodyChars: 150000
```

Prefer the credential reference or launch environment, not `apiKey`. A literal
`apiKey` overrides even a key saved through the configuration page; remove that override and
restart DSH Web before managing the key through **Plugins**. Never put a key in a
committed patch. Only use a trusted `baseURL`: it receives the bearer credential.
`maxBodyChars` limits returned markdown, not the HTTP response download size.

## Credential security

The configuration page uses DSH's existing loopback-only credential API. The browser
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

## Development

Maintained host code lives in `src/`, shared credential contracts in `shared/`, and
React components and registration in `client/`. Strict checks enable
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. The manifest loads
[the generated host](dist/src/index.js); [the generated client](client.js) retains the lazy-loader package ID and named exports.
Do not edit generated files directly.

With the repository's pinned development dependencies available, run these commands
from the repository root. They use the shared compiler and bundler and make no provider calls:

```sh
node packages/dsh-web-firecrawl/scripts/typecheck.mjs
node packages/dsh-web-firecrawl/scripts/build-host.mjs
node packages/dsh-web-firecrawl/scripts/build-client.mjs
node packages/dsh-web-firecrawl/scripts/build-host.mjs --check
node packages/dsh-web-firecrawl/scripts/build-client.mjs --check
node node_modules/vitest/vitest.mjs run --config packages/dsh-web-firecrawl/vitest.browser.config.mjs
```

The package's [browser configuration](vitest.browser.config.mjs) reuses the root setup
but keeps runner caches and failure screenshots in the package's ignored `.cache/`
directory. Use it when dependencies are borrowed read-only in a worktree.

Both normal Node test files enforce strict contracts and artifact freshness, so the
root's explicit test list needs no additional entry. Compile-time negative cases
protect provider inputs and the write-only credential RPC contract. Packaged files
include generated `dist/` and `client.js`, not development sources or build scripts.
Profile updates and restarts still require separate approval.

## Test

```sh
pnpm --filter @local/dsh-web-firecrawl test
```

The unit tests use mocked HTTP responses and do not consume Firecrawl
credits. Run `pnpm --filter @local/dsh-web-firecrawl test:integration` for repository
manifest/recipe/dry-run checks; the original standalone Web-server smoke test is
adapted to this repository so it does not create another home, profile, or server.
`pnpm test` includes both suites. `pnpm run test:browser` also discovers this
package's real React interactions with mocked credential RPCs.

The client explicitly injects `slots`, `remote`, and **`remote.credentials`** and
uses `ctx.remote.credentials.describe([ref])`, `set(ref, value)`, and `unset(ref)`.
Responses use `{ ok, value/error }`, never `response.result`. The
`plugins.row.config` slot key is `@local/dsh-web-firecrawl#local-web-firecrawl`,
matching the bundle package and host row ID. Summary rendering is static; page
rendering opens the existing credential form. DSH `0.1.7-rc.2` removes
`settings.installSection`, and row-page discovery needs no empty settings namespace.
The host runs without Settings; secrets are edited only through the credential API.
Provider options remain ordinary Cordis configuration, not volatile form fields.

The scoped browser tests use real React and Chromium with mocked credential RPCs
and slot registration. They cover static summaries, the open row page, and credential
form interactions. These checks do not prove real-shell slot election or live
Firecrawl access; use the repository's shared real-UI validation separately.
