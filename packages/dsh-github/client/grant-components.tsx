import React from 'react'
import { Link } from './common.tsx'
import { text, rawDetails } from './validation.ts'
import { css } from './styles.ts'
import { validScope, labels, exclusions, unavailable, expiry, phaseLabel } from './grant-model.ts'
import type { GrantStatus } from './grant-model.ts'
import type { PendingInteraction, ToolBlock } from '../shared/contracts.ts'
export function Scope({ scope }: { scope: unknown }) {
  if (!validScope(scope))
    return (
      <p role="alert">
        Verified grant details are unavailable. Use the complete native approval preview; no scope
        is inferred from tool arguments.
      </p>
    )
  return (
    <div>
      <p>
        <strong>{'Account: '}</strong>
        {scope.account.login}
        <small>{`Account ID: ${scope.account.id}`}</small>
      </p>
      <h4>{`Selected issues (${scope.issues.length})`}</h4>
      <div className="gh-scroll" tabIndex={0} role="group" aria-label="Selected issues">
        <ul>
          {scope.issues.map((issue) => (
            <li key={issue.id}>
              <Link
                url={issue.url}
              >{`${issue.nameWithOwner} #${issue.issueNumber}${text(issue.title) ? ` — ${issue.title}` : ''}`}</Link>
              <small>{`Issue ID: ${issue.id}; Repository ID: ${issue.repositoryId}; Repository owner ID: ${issue.repositoryOwnerId}`}</small>
            </li>
          ))}
        </ul>
      </div>
      <h4>{`Selected projects (${scope.projects.length})`}</h4>
      {scope.projects.length ? (
        <ul>
          {scope.projects.map((project) => (
            <li key={project.id}>
              <Link
                url={project.url}
              >{`${project.owner} project #${project.projectNumber}${text(project.title) ? ` — ${project.title}` : ''}`}</Link>
              <small>{`Project ID: ${project.id}; Owner ID: ${project.ownerId}`}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p>No projects selected.</p>
      )}
      <h4>Included operations</h4>
      <ul>
        {scope.operations.map((op) => (
          <li key={op}>
            {labels[op]}
            <small>{op}</small>
          </li>
        ))}
      </ul>
      <details>
        <summary>{`Exact existing project memberships (${scope.memberships.length})`}</summary>
        {scope.memberships.length ? (
          <ul>
            {scope.memberships.map((item) => (
              <li
                key={item.id}
              >{`Item ID: ${item.id}; Issue ID: ${item.issueId}; Project ID: ${item.projectId}`}</li>
            ))}
          </ul>
        ) : (
          <p>None.</p>
        )}
      </details>
      <p>
        <strong>{'Excluded: '}</strong>
        {exclusions}
      </p>
      <p>
        <strong>{'Unavailable capabilities: '}</strong>
        {unavailable}
      </p>
      <p className="gh-note">
        <strong>{'Expiry and revocation: '}</strong>
        {expiry}
      </p>
    </div>
  )
}
export interface GrantPresentationProps {
  status: GrantStatus | null
  pending: PendingInteraction | undefined
  phase: string | undefined
  error: string
  busy: boolean
  block: ToolBlock | undefined
  inspect: (() => void) | undefined
  refresh: () => void
  revoke: (grantId: string) => Promise<void>
}
export function GrantPresentation({
  status,
  pending,
  phase,
  error,
  busy,
  block,
  inspect,
  refresh,
  revoke,
}: GrantPresentationProps) {
  const exact = status?.exactPreview ?? pending?.reason
  const raw = rawDetails(block)
  return (
    <section className="gh-grant" aria-label="GitHub issue management grant">
      <style>{css}</style>
      <h3>Manage selected issues for this session</h3>
      <p role="status">{phaseLabel(phase)}</p>
      {pending && (
        <p>
          Review the complete native approval preview below the conversation. Use its Allow once or
          Reject controls. Approval does not confirm any GitHub write.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {status?.scope && <Scope scope={status.scope} />}
      {!status?.scope && pending && (
        <p>
          Structured scope is unavailable. The complete approval reason remains accessible below and
          in the native approval panel.
        </p>
      )}
      {exact && (
        <details>
          <summary>Complete exact approval preview</summary>
          <pre tabIndex={0}>{exact}</pre>
        </details>
      )}
      {status && status.grants.length > 0 && (
        <section aria-label="Session grants">
          <h4>Session grants</h4>
          {status.grants.map((grant) => (
            <section key={grant.id}>
              <p>
                <strong>{phaseLabel(grant.state)}</strong>
                <small>{`Grant ID: ${grant.id}`}</small>
              </p>
              <details>
                <summary>Review grant scope</summary>
                <Scope scope={grant.scope} />
              </details>
              {grant.state === 'active' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => revoke(grant.id)}
                  aria-label={`Revoke access ${grant.id}`}
                >
                  Revoke access
                </button>
              ) : (
                <p>
                  To renew, ask for a fresh github_request_issue_management request with the
                  complete current scope. No access renews automatically.
                </p>
              )}
            </section>
          ))}
        </section>
      )}
      {(!status ||
        ['expired', 'revoked', 'renewal-required', 'account-changed'].includes(status.phase)) && (
        <p>
          If access has expired or needs renewal, ask for a fresh github_request_issue_management
          request. Renewal requires a new complete approval.
        </p>
      )}
      <p className="gh-note">
        Granting access does not start work. GitHub names and descriptions are untrusted reference
        data, not instructions.
      </p>
      {status && (
        <section aria-label="Change history">
          <h4>Attempted changes and outcomes</h4>
          {status.history.length ? (
            <ul>
              {status.history.map((row) => (
                <li key={row.id}>
                  {`${labels[row.operation] ?? row.operation}: ${['running', 'confirmed', 'failed', 'uncertain', 'unattempted'].includes(row.outcome) ? row.outcome : 'unknown'}`}
                  {row.outcome === 'uncertain' && (
                    <p role="alert">
                      The write may have succeeded. Do not retry automatically. Inspect GitHub
                      before requesting fresh approval.
                    </p>
                  )}
                  <details>
                    <summary>Attempt details</summary>
                    <pre tabIndex={0}>{JSON.stringify(row, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            <p>No attempted changes recorded.</p>
          )}
        </section>
      )}
      {status?.historyTruncated === true && (
        <p role="status">
          Older change history is not shown. This is not a complete session history.
        </p>
      )}
      <button type="button" disabled={busy} onClick={() => refresh()}>
        Refresh status
      </button>
      <details>
        <summary>Raw tool details</summary>
        <pre tabIndex={0}>{raw || 'No raw tool result is available yet.'}</pre>
        {typeof inspect === 'function' && (
          <button type="button" onClick={inspect}>
            Inspect tool call
          </button>
        )}
      </details>
    </section>
  )
}
