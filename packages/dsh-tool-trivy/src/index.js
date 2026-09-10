import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerTrivyStatusRpc } from './status.js'
import {
  createTrivyRuntime,
  renderTrivyResult,
  scanWithTrivy,
} from './trivy.js'

export * from './status.js'
export * from './trivy.js'

export const name = 'tool-trivy'
export const inject = ['tools', 'subprocess', 'skills']

const PROVIDER_NAME = 'trivy-audit'
const SKILL_BODY_URL = new URL('../assets/trivy-audit.md', import.meta.url)
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/', import.meta.url)),
}
const SKILL_CANDIDATE = {
  name: 'trivy-audit',
  description: 'Audit a local repository with Trivy for dependency vulnerabilities and infrastructure-as-code misconfigurations. Use when the user requests a vulnerability audit, dependency CVE review, security scan, Trivy scan, or remediation and rescan workflow.',
  whenToUse: 'Use for repository-focused vulnerability and IaC audits when the pre-installed Trivy CLI is available.',
  invocation: {
    modelInvocable: true,
    userInvocable: true,
  },
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

export function createTrivySkillProvider() {
  return {
    name: PROVIDER_NAME,
    list: () => Promise.resolve([SKILL_CANDIDATE]),
    async get() {
      return {
        name: SKILL_CANDIDATE.name,
        description: SKILL_CANDIDATE.description,
        whenToUse: SKILL_CANDIDATE.whenToUse,
        invocation: SKILL_CANDIDATE.invocation,
        provider: SKILL_CANDIDATE.provider,
        source: SKILL_CANDIDATE.source,
        resourceBase: RESOURCE_BASE,
        content: await readFile(SKILL_BODY_URL, 'utf8'),
      }
    },
  }
}

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, enum: ['vulnerability', 'misconfiguration'] },
    target: { type: 'string', required: true },
    id: { type: 'string', required: true },
    severity: { type: 'string', required: true, enum: ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
    title: { type: 'string' },
    package: { type: 'string' },
    installedVersion: { type: 'string' },
    fixedVersion: { type: 'string' },
    message: { type: 'string' },
    resolution: { type: 'string' },
    resource: { type: 'string' },
    status: { type: 'string' },
    primaryUrl: { type: 'string' },
  },
}

const COUNTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    UNKNOWN: { type: 'integer', required: true },
    LOW: { type: 'integer', required: true },
    MEDIUM: { type: 'integer', required: true },
    HIGH: { type: 'integer', required: true },
    CRITICAL: { type: 'integer', required: true },
  },
}

export const TRIVY_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scannerVersion: { type: 'string', required: true },
    target: { type: 'string', required: true },
    scanners: {
      type: 'array',
      required: true,
      items: { type: 'string', enum: ['vulnerability', 'misconfiguration'] },
    },
    severities: {
      type: 'array',
      required: true,
      items: { type: 'string', enum: ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
    },
    ignoreUnfixed: { type: 'boolean', required: true },
    totals: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        bySeverity: COUNTS_SCHEMA,
        byKind: {
          type: 'object',
          additionalProperties: false,
          required: true,
          properties: {
            vulnerabilities: { type: 'integer', required: true },
            misconfigurations: { type: 'integer', required: true },
          },
        },
      },
    },
    totalFindings: { type: 'integer', required: true },
    returnedFindings: { type: 'integer', required: true },
    truncated: { type: 'boolean', required: true },
    findings: { type: 'array', required: true, items: FINDING_SCHEMA },
  },
}

export function registerTrivyTool(ctx, runtime) {
  ctx.tools.register(defineTool({
    name: 'trivy_scan',
    description: 'Scan a file or directory inside the active workspace with the pre-installed Trivy CLI for dependency vulnerabilities and IaC misconfigurations. Trivy must be available on DSH’s effective PATH; the plugin never installs it.',
    parameters: {
      target: {
        type: 'string',
        description: 'Workspace-relative file or directory to scan. Defaults to the workspace root. Targets outside the active workspace are rejected.',
      },
      scanners: {
        type: 'array',
        items: { type: 'string', enum: ['vulnerability', 'misconfiguration'] },
        description: 'Scanner categories. Defaults to both vulnerability and misconfiguration.',
      },
      severities: {
        type: 'array',
        items: { type: 'string', enum: ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
        description: 'Finding severities to include. Defaults to HIGH and CRITICAL.',
      },
      ignoreUnfixed: {
        type: 'boolean',
        description: 'Exclude vulnerabilities without a published fixed version. Defaults to false.',
      },
    },
    output: {
      schema: TRIVY_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderTrivyResult(value) }],
    },
    timeoutMs: 310_000,
    isConcurrencySafe: () => false,
    execute: (args, exec) => scanWithTrivy(runtime, ctx.subprocess, args, exec),
    presentCall: (args) => ({
      card: 'generic',
      title: `Trivy scan: ${args.target ?? '.'}`,
      kind: 'execute',
      rawInput: args.target ?? '.',
    }),
  }))
}

export function apply(ctx) {
  const runtime = createTrivyRuntime(ctx.subprocess)
  ctx.skills.registerProvider(() => createTrivySkillProvider())
  ctx.inject(['connection', 'webServer'], (webCtx) => registerTrivyStatusRpc(webCtx, runtime))
  registerTrivyTool(ctx, runtime)
}
