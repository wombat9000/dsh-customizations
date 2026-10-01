import React from 'react'
import type { CardProps } from '../shared/contracts.ts'
import { Link } from './common.tsx'
import { css } from './styles.ts'
import { object, text, rawDetails } from './validation.ts'
import { supplied } from './read-models.ts'
import {
  pullRequestCardModel,
  pullRequestEntryLabel,
  pullRequestEntryContext,
} from './pull-request-model.ts'

function Entry({ entry }: { entry: Record<string, unknown> }) {
  const memberConnection = entry.pullRequests ?? entry.pull_requests
  const members = object(memberConnection) ? memberConnection.nodes : memberConnection
  const position = entry.position
  const pr = object(entry.pullRequest) ? entry.pullRequest : entry
  return (
    <article className="gh-pr-row">
      <strong>
        <Link url={pr.url ?? pr.html_url ?? pr.detailsUrl ?? pr.targetUrl}>
          {Array.isArray(members)
            ? `Stack #${entry.number} · ${supplied(memberConnection, 'totalCount') ?? members.length} layers · trunk ${text(supplied(entry.base, 'ref')) || 'unavailable'}`
            : pullRequestEntryLabel(pr)}
        </Link>
      </strong>
      {typeof position === 'number' && <small>{`Layer ${position}`}</small>}
      <p>{pullRequestEntryContext(pr).join(' · ')}</p>
      {Array.isArray(members) && (
        <>
          <ol aria-label="Stack layers, bottom to top">
            {members.slice(0, 5).map((member: unknown, index) => (
              <li key={index}>
                {object(member) ? (
                  <Link url={member.url ?? member.html_url}>
                    {pullRequestEntryLabel(member)} · {pullRequestEntryContext(member).join(' · ')}
                  </Link>
                ) : (
                  'Layer unavailable'
                )}
              </li>
            ))}
          </ol>
          {members.length > 5 && (
            <details>
              <summary>{`Remaining returned layers (${members.length - 5})`}</summary>
              <ol start={6}>
                {members.slice(5, 50).map((member: unknown, index) => (
                  <li key={index}>
                    {object(member) ? (
                      <Link url={member.url ?? member.html_url}>
                        {pullRequestEntryLabel(member)} ·{' '}
                        {pullRequestEntryContext(member).join(' · ')}
                      </Link>
                    ) : (
                      'Layer unavailable'
                    )}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
      {members === undefined &&
        typeof entry.baseRefName === 'string' &&
        typeof entry.size === 'number' && (
          <p>{`${entry.size} layers · trunk ${entry.baseRefName}`}</p>
        )}
      {entry.stack === null && <small>No native stack membership</small>}
      {object(entry.stack) && (
        <small>{`Stack #${text(String(entry.stack.number ?? ''))}${Number.isSafeInteger(supplied(entry.stackEntry, 'position')) ? ` · layer ${supplied(entry.stackEntry, 'position')}` : ''}`}</small>
      )}
    </article>
  )
}
function Changes({ change }: { change: Record<string, unknown> }) {
  const { before, after } = change
  const format = (key: string, value: unknown) =>
    key === 'draft' && typeof value === 'boolean'
      ? value
        ? 'Draft'
        : 'Ready for review'
      : typeof value === 'string'
        ? value
        : JSON.stringify(value, null, 2)
  return (
    <details>
      <summary>Approved changes</summary>
      {object(after) ? (
        Object.entries(after).map(([key, value]) => (
          <div key={key}>
            <strong>{key === 'draft' ? 'Readiness' : key}</strong>
            {object(before) && Object.hasOwn(before, key) && (
              <>
                <pre>{format(key, before[key])}</pre>
                <span> → </span>
              </>
            )}
            <pre>{format(key, value)}</pre>
          </div>
        ))
      ) : Array.isArray(after) && after.every(Number.isSafeInteger) ? (
        <>
          <p>{`Before: ${Array.isArray(before) ? before.map((number) => `#${number}`).join(' → ') : 'No stack'}`}</p>
          <p>{`After: ${after.map((number) => `#${number}`).join(' → ')}`}</p>
        </>
      ) : (
        <pre>{JSON.stringify(change, null, 2)}</pre>
      )}
    </details>
  )
}
export function PullRequestCard({ toolName, block, inspect }: CardProps & { toolName: string }) {
  const model = pullRequestCardModel(toolName, block)
  return (
    <section className="gh-grant gh-pr" aria-label={`GitHub ${model.title}`}>
      <style>
        {css}
        {`
      .gh-pr { min-width:0; overflow-wrap:anywhere; }
      .gh-pr h3 { margin:0; font-size:inherit; }
      .gh-pr p { margin:4px 0; }
      .gh-pr-row { padding:6px 0; border-top:1px solid var(--border-color,#8884); }
      .gh-pr-row small { margin-left:6px; }
      .gh-pr pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:300px; overflow:auto; }
      .gh-pr [role="note"] { font-size:0.9em; }
    `}
      </style>
      <h3>{`GitHub · ${model.title}`}</h3>
      {model.target && <small>{model.target}</small>}
      <p role="status">
        {model.status}
        {model.total === undefined ? '' : ` · ${model.total} total reported`}
      </p>
      {model.error && <p role="alert">{model.error}</p>}
      {model.warnings.map((warning, index) => (
        <p role="note" key={index}>
          {warning}
        </p>
      ))}
      {model.pullRequest && (
        <small>
          <Link url={model.pullRequest.url}>{pullRequestEntryLabel(model.pullRequest)}</Link> ·{' '}
          {pullRequestEntryContext(model.pullRequest).join(' · ')}
        </small>
      )}
      {model.entries.slice(0, 5).map((entry, index) => (
        <Entry key={index} entry={entry} />
      ))}
      {model.entries.length > 5 && (
        <details>
          <summary>{`Remaining entries (${model.entries.length - 5})`}</summary>
          {model.entries.slice(5).map((entry, index) => (
            <Entry key={index} entry={entry} />
          ))}
        </details>
      )}
      {model.change && <Changes change={model.change} />}
      <details>
        <summary>Raw tool details</summary>
        <pre tabIndex={0}>{rawDetails(block) || 'No raw tool result is available yet.'}</pre>
        {inspect && (
          <button type="button" onClick={inspect}>
            Inspect tool call
          </button>
        )}
      </details>
    </section>
  )
}
