# DSH 0.1.5-rc.2 dependency validation

## Result

The authoritative manifests and normal pnpm lockfile now target RC2 directly. Validation passes on Linux ARM64 with Node.js 22.22.1 and the verified local pnpm 11.9.0 executable. No plugin implementation migration is required by these tests.

Work starts from a clean `main` at `27d16702d079d83776334e92e37f7be0fdc4ac60`, six commits after the adopted `02061ea15db635129804b32ecd99fdcc5f13e3eb`. Those intervening changes remain intact. The starting SHA does not contain this update; use the reviewed PR commit for adoption.

## Changes and boundaries

- Update 61 existing DSH dependency declarations, including peer and development dependencies, to `0.1.5-rc.2`.
- Update the existing release-age exceptions and the checkout-local apply command's target. Do not add overrides or an alternative version manifest.
- Retain the byte-identical RPC ownership patch using `getTraceable(this.ctx, this.ctx)`. Its historical RC1 filename remains; `patchedDependencies` and the lock hash bind it to RC2.
- Update active version assertions and documentation. Keep RC1 preset snapshot provenance and migration results historical.
- Add normal-lockfile and installed-launcher regression tests. Extend the isolated smoke test to all twelve local recipe bundles.
- Preserve package identities, credential/settings namespaces, transcript storage paths, approval gates, and preset composition. Unrelated direct dependency versions, including Cordis, Schemastery, React, Linear SDK, and Google Gen AI SDK, remain unchanged.

No consuming DSH checkout, deployed profile, service, credentials, or runtime history is modified. The user separately authorizes committing and pushing this update for PR review. No deployment or service restart occurs. Test hosts use disposable directories and shut down after validation.

## Installation and resolved graph

Dependency directories and the pnpm virtual store belong to this checkout. The initial local cache has no RC2 packages. The user explicitly approves network resolution/cache population and scripts-disabled installation.

The initial normal lock update retains RC1 auto-peer resolutions. Targeted update and lockfile repair also retain RC1 peers. Clean regeneration without the wanted or installed lock input removes that stale preference. The user separately approves the incidental transitive refresh listed below.

Final commands, with inherited `NODE_PATH` unset:

```sh
env -u NODE_PATH pnpm install --lockfile-only --ignore-scripts
env -u NODE_PATH pnpm install --frozen-lockfile --ignore-scripts
env -u NODE_PATH pnpm install --offline --frozen-lockfile --ignore-scripts
```

All pass. The final lock contains no RC1 version text. Traversal from the root and local package manifests finds **231 reachable DSH packages in 231 resolution contexts**, all RC2 and checkout-owned. Every reachable Connection context contains the RPC-owner patch. The normal lockfile's patch hash matches the unchanged patch bytes.

### Approved incidental transitive refresh

These are normal lockfile changes, not new direct dependency declarations:

| Package | Previous | Resolved |
| --- | --- | --- |
| `@aws-sdk/core` | 3.977.9 | 3.978.0 |
| `@aws-sdk/credential-provider-env` | 3.972.70 | 3.972.71 |
| `@aws-sdk/credential-provider-http` | 3.972.72 | 3.972.73 |
| `@aws-sdk/credential-provider-ini` | 3.973.15 | 3.973.16 |
| `@aws-sdk/credential-provider-login` | 3.972.77 | 3.972.78 |
| `@aws-sdk/credential-provider-node` | 3.972.82 | 3.972.83 |
| `@aws-sdk/credential-provider-process` | 3.972.70 | 3.972.71 |
| `@aws-sdk/credential-provider-sso` | 3.973.14 | 3.973.15 |
| `@aws-sdk/credential-provider-web-identity` | 3.972.76 | 3.972.77 |
| `@aws-sdk/middleware-websocket` | 3.972.52 | 3.972.53 |
| `@aws-sdk/nested-clients` | 3.997.44 | 3.997.45 |
| `@aws-sdk/token-providers` | 3.1116.0 | 3.1129.0 |
| `@babel/parser` | 8.0.4 | 8.0.5 |
| `@babel/types` | 8.0.4 | 8.0.5 |
| `@napi-rs/wasm-runtime` | 1.2.3 | 1.2.4 |
| `@smithy/core` | 3.33.3 | 3.34.1 |
| `compression` | 1.8.1 | 1.8.2 |
| `magic-string` | 1.2.3 | 1.3.1 |
| `nanoid` | 3.3.18 | 3.3.19 |
| `open` | 11.0.2 | 11.0.3 |
| `vite` | 8.2.2 | 8.3.0 |

`destroy@1.2.0` is an added transitive package. Lifecycle scripts remain disabled throughout installation. No browser or Trivy executable is provisioned.

## Validation results

Every command below runs with `NODE_PATH` unset, except the Git whitespace check and the managed Trivy tool.

| Check | Result |
| --- | --- |
| `pnpm run check` | Pass: one recipe, 24 package references |
| `pnpm test` | Pass: pretest builds and type-checks Session Environment host/client; 1,106 tests pass, zero failures or skips |
| `node --test scripts/apply-profile.test.mjs` | Pass: 18 tests, including RC1 launcher rejection before profile writes |
| `pnpm run test:browser` | Pass: 128 tests in 11 Chromium files |
| `node tests/real-ui/migration-boot.mjs` | Pass: twelve local bundles through real Loader/Web startup, persisted synthetic fixture, authentication, shell HTTP 200, and read-only Recap/Worktree RPC responses |
| `pnpm run test:visual` | Pass: 15 real-host tests; existing screenshots compare successfully without baseline updates |
| Manifest and installed-graph assertions | Pass: target-only DSH pins, unrelated direct versions unchanged, byte-identical patch, 231 reachable RC2 packages |
| `git diff --check` | Pass |

The browser suite emits non-failing Vitest/Vite hook and React `act(...)` warnings. Node.js emits its experimental SQLite warning. Installation reports the existing deprecated `node-domexception@1.0.0` transitive dependency. No fixture layout failures or RC2 compatibility regressions remain in these runs.

## Trivy audit

Trivy **0.72.0** scans `/home/agent/workspace/autostein/dsh-customizations` with the `vulnerability` and `misconfiguration` scanners, `HIGH` and `CRITICAL` severities, and `ignoreUnfixed: false`.

- Dependency vulnerabilities: **0**.
- IaC misconfigurations: **0**.
- Critical: **0**; high: **0**.
- No truncation warning is returned.

No findings match these filters. This is not an all-severity audit or proof that the repository has no security issues. No security remediation is performed.

## Remaining limits

RC2 still requires the RPC-owner patch in each independent runtime graph. A deployment that copies these manifests no longer needs to rewrite their DSH declarations, but it must retain its own patch configuration and validate its resolved graph. This task does not modify that deployment.

Tests exercise isolated local hosts and fixtures, not production credentials, paid providers, every plugin RPC, or deployed host/sandbox state. Passing Linux ARM64 checks do not establish installation cache completeness on another machine. Use the reviewed PR commit SHA for adoption; opening the PR does not authorize merging or deployment.
