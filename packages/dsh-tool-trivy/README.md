# @local/dsh-tool-trivy

DSH bundle providing a controlled `trivy_scan` repository-audit tool, the bundled `trivy-audit` skill, and a Web Settings readiness panel.

## Prerequisite

Install [Trivy](https://trivy.dev/latest/getting-started/installation/) separately and ensure `trivy` is visible on the effective `PATH` of the DSH process. The plugin does not install, update, download, or configure the Trivy executable.

Open **Settings → Trivy** to inspect the detected version or force a recheck. Trivy 0.50.0 or newer is required. The first scan may download or update Trivy's vulnerability database.

## Tool

`trivy_scan` audits a file or directory inside the active session workspace. Version one supports dependency vulnerabilities and infrastructure-as-code misconfigurations. Targets outside the canonical workspace are rejected, raw Trivy arguments are not accepted, and result details are bounded with explicit truncation metadata. Package-owned empty `--config` and `--ignorefile` inputs prevent repository `trivy.yaml` and `.trivyignore` files from redirecting output or suppressing findings.

Default behavior:

- target: workspace root;
- scanners: vulnerability and misconfiguration;
- severities: high and critical;
- unfixed findings: included.

Image, registry, Kubernetes, remote-repository, secret, and automatic-remediation workflows are out of scope.

## Skill

The bundled `trivy-audit` skill teaches agents how to scope an audit, interpret findings, inspect manifests/configuration before remediation, preserve caveats, and rescan after changes. It also instructs agents never to install Trivy or silently substitute another scanner.

## Install

This bundle is maintained in `packages/dsh-tool-trivy` and selected by the `personal-web` recipe. Follow the [repository setup and profile application procedure](../../README.md#apply-the-starter-profile). Dependency installation, profile updates, and DSH restarts require separate approval. After an approved update and restart, refresh the existing Web URL and open **Settings → Trivy**. Installing the bundle does not install Trivy.

## Development

After the repository's approved dependency setup, run these commands from the repository root. Unit tests mock the subprocess service and do not require an installed Trivy binary. `test:integration` checks package/recipe wiring and a dormant RPC handler; it does not install dependencies, start DSH, execute Trivy, or verify a live browser.

```sh
pnpm --filter @local/dsh-tool-trivy test
pnpm --filter @local/dsh-tool-trivy test:integration
```
