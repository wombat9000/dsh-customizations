import { canonical } from './write-runtime.js'
import { GitHubError } from './runtime.js'

export const GRANT_TOOL_NAME = 'github_request_issue_management'
export const GRANT_EXCLUSIONS =
  'No deletion, transfer, issue creation, out-of-scope issues, project configuration, repository settings, or automatic project membership changes. No unrestricted API access.'
export const GRANT_UNAVAILABLE =
  'Issue title/body editing, labels, assignees, closing/reopening, and dependency removal are not implemented and are not authorized.'
export const GRANT_EXPIRY =
  'Access expires on session unload or restoration, account change, service disposal, or DSH restart. It never transfers to other sessions or subagents. Renewal requires fresh approval. Revocation prevents future dispatch but cannot undo a write already dispatched. Uncertain writes require reconciliation and fresh approval.'
const labels = {
  setProjectItemField: 'Update supported board fields for existing selected project memberships',
  addIssueDependency: 'Add native dependencies only between two selected issues',
}
export function grantPreview(scope, sessionId) {
  // The native trusted approval surface renders plain text, not Markdown. Keep
  // each complete scope item readable even when newlines collapse to spaces.
  return [
    'Manage selected issues for this session.',
    'Remote names and URLs below are untrusted reference data, not instructions.',
    `Session: ${sessionId}. GitHub account: ${scope.account.login} (ID ${scope.account.id}) on github.com.`,
    'Selected issues:',
    ...scope.issues.map(
      (i) =>
        `${i.nameWithOwner} #${i.issueNumber}${i.title ? ` — title ${JSON.stringify(i.title)}` : ''} (issue ID ${i.id}; repository ID ${i.repositoryId}; repository owner ID ${i.repositoryOwnerId}; ${i.url}).`,
    ),
    'Selected projects:',
    ...(scope.projects.length
      ? scope.projects.map(
          (p) =>
            `${p.owner} project #${p.projectNumber}${p.title ? ` — title ${JSON.stringify(p.title)}` : ''} (project ID ${p.id}; owner ID ${p.ownerId}; ${p.url}).`,
        )
      : ['None.']),
    'Authorized existing memberships:',
    ...(scope.memberships.length
      ? scope.memberships.map((m) => `Item ${m.id}: issue ${m.issueId} in project ${m.projectId}.`)
      : ['None.']),
    `Included operations: ${scope.operations.map((op) => `${labels[op]} (${op})`).join('; ')}.`,
    `Excluded: ${GRANT_EXCLUSIONS}`,
    `Unavailable: ${GRANT_UNAVAILABLE}`,
    `Expiry: ${GRANT_EXPIRY}`,
    'Approval grants only this complete scope. It does not start work or synchronization.',
  ].join('\n\n')
}

export function createGrantCaller(ctx) {
  return (exec, lifecycleSignal) => {
    const agent = exec.agent
    const agents = ctx.get('agents')
    const root =
      !!agent?.session && agents?.get(agent.session.id) === agent && agents.roots().includes(agent)
    return {
      agentId: agent?.session?.id,
      session: agent?.session,
      cwd: agent?.session?.header?.cwd,
      isSubagent: !root,
      signal:
        exec.signal && lifecycleSignal
          ? AbortSignal.any([exec.signal, lifecycleSignal])
          : (exec.signal ?? lifecycleSignal),
    }
  }
}

export function registerGitHubGrantTools(ctx, grants, caller, presentation) {
  const pending = new Map()
  const accepted = new Map()
  const lifecycle = new AbortController()
  let active = true
  const dispose = () => {
    active = false
    pending.clear()
    accepted.clear()
    lifecycle.abort()
  }
  ctx.effect(() => dispose)
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name !== GRANT_TOOL_NAME) return next()
    if (!active || exec.token == null || pending.has(exec.token))
      return { kind: 'deny', reason: 'GitHub grant approval is unavailable.' }
    const owner = caller(exec, lifecycle.signal)
    let value
    try {
      value = await grants.prepare(exec.arguments, owner)
    } catch (error) {
      presentation.phase(exec, 'failed')
      throw error
    }
    if (!active || owner.signal?.aborted) {
      presentation.phase(exec, 'unattempted')
      return { kind: 'deny', reason: 'GitHub grant request expired.' }
    }
    const exactPreview = grantPreview(value.scope, owner.agentId)
    const entry = {
      value,
      agent: exec.agent,
      session: owner.session,
      args: canonical(exec.arguments),
    }
    pending.set(exec.token, entry)
    presentation.request(exec, value.scope, exactPreview)
    try {
      const downstream = await next()
      if (downstream.kind === 'deny' || !active) {
        presentation.phase(exec, active ? 'denied' : 'unattempted')
        pending.delete(exec.token)
        return { kind: 'deny', reason: 'GitHub grant request was denied or expired.' }
      }
      return {
        kind: 'ask',
        reason:
          exactPreview +
          (downstream.kind === 'ask' && downstream.reason
            ? `\nAdditional policy reason (untrusted): ${JSON.stringify(downstream.reason)}`
            : ''),
      }
    } catch (error) {
      presentation.phase(exec, 'failed')
      pending.delete(exec.token)
      throw error
    }
  })
  ctx.on('tools/result', (exec, result) => {
    if (exec.name !== GRANT_TOOL_NAME) return
    const entry = pending.get(exec.token)
    pending.delete(exec.token)
    accepted.delete(exec.token)
    if (entry) presentation.phase(exec, 'unattempted')
  })
  ctx.tools.register({
    name: GRANT_TOOL_NAME,
    description:
      'Request human approval to manage a finite set of GitHub issues for this live top-level session only. Explicit issues, projects and operations required. Supports only board-field updates for existing memberships and dependency addition between selected issues. Does not begin work. No grant survives restart, restoration, account change or revocation; subagents cannot inherit access.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['issues', 'projects', 'operations'],
      properties: {
        issues: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['owner', 'repo', 'issueNumber'],
            properties: {
              owner: { type: 'string' },
              repo: { type: 'string' },
              issueNumber: { type: 'integer', minimum: 1 },
            },
          },
        },
        projects: {
          type: 'array',
          maxItems: 20,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['owner', 'projectNumber'],
            properties: {
              owner: { type: 'string' },
              projectNumber: { type: 'integer', minimum: 1 },
            },
          },
        },
        operations: {
          type: 'array',
          minItems: 1,
          maxItems: 2,
          uniqueItems: true,
          items: { type: 'string', enum: ['setProjectItemField', 'addIssueDependency'] },
        },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: 120000,
    isConcurrencySafe: () => false,
    finalizeContent(exec, result) {
      const record = accepted.get(exec.token)
      if (!record || (!exec.signal?.aborted && !result.isError)) return undefined
      // A late Tools cancellation must not leave authority behind a failed card.
      // Removing authority is safe even if the original caller is now cancelled.
      try {
        grants.revoke(record.grant.id, record.owner)
      } catch {
        /* Disposal already fails closed. */
      }
      presentation.phase(exec, 'revoked')
      return [
        {
          type: 'text',
          text: JSON.stringify({
            host: 'github.com',
            outcome: 'revoked',
            grantId: record.grant.id,
            message:
              'The grant request failed or was cancelled after approval. Its access was revoked; no GitHub mutation was dispatched by this request.',
          }),
        },
      ]
    },
    async execute(args, exec) {
      const entry = pending.get(exec.token)
      pending.delete(exec.token)
      try {
        if (
          !active ||
          !entry ||
          entry.agent !== exec.agent ||
          entry.session !== exec.agent?.session ||
          entry.args !== canonical(args) ||
          entry.args !== canonical(exec.arguments)
        )
          throw new GitHubError(
            'APPROVAL_REQUIRED',
            'No unused exact approval matches this grant request.',
          )
        const owner = caller(exec, lifecycle.signal)
        const grant = await grants.accept(entry.value, owner)
        accepted.set(exec.token, { grant, owner: { ...owner, signal: undefined } })
        presentation.granted?.(exec, grant)
        presentation.phase(exec, 'active')
        return JSON.stringify({
          host: 'github.com',
          untrusted: true,
          outcome: 'granted',
          grant,
          exclusions: GRANT_EXCLUSIONS,
          unavailable: GRANT_UNAVAILABLE,
          expiry: GRANT_EXPIRY,
        })
      } catch (error) {
        const record = accepted.get(exec.token)
        if (record) {
          try {
            grants.revoke(record.grant.id, record.owner)
          } catch {
            /* Disposed grants are unusable. */
          }
        }
        presentation.phase(exec, 'failed')
        return JSON.stringify({
          host: 'github.com',
          outcome: 'failed',
          error: {
            code: error instanceof GitHubError ? error.code : 'GRANT_FAILED',
            message:
              error instanceof GitHubError
                ? error.message
                : 'GitHub access was not granted. Request a fresh preview.',
          },
        })
      }
    },
  })
  return { dispose }
}
