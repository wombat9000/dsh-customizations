import React from 'react'
import type { CardProps } from '../shared/contracts.ts'
import type { PRCardModel } from './pull-request-model.ts'
import { Link } from './common.tsx'
import { css } from './styles.ts'
import { supplied } from './collection-completeness.ts'
import { rawDetails, text } from './validation.ts'

function stateLabel(entry: Record<string, unknown>): string {
  const state = text(entry.state).toLowerCase()
  const mergedAt = text(entry.mergedAt)
  if (
    state === 'merged' ||
    (state === 'closed' &&
      /^\d{4}-\d{2}-\d{2}T/.test(mergedAt) &&
      Number.isFinite(Date.parse(mergedAt)))
  )
    return 'Merged'
  if (state === 'closed') return 'Closed'
  if (state === 'open') return (entry.isDraft ?? entry.draft) === true ? 'Draft' : 'Open'
  return 'State unknown'
}

/** GitHub's REST dates are UTC ISO timestamps. Never let Date.parse normalize
 * invalid calendar dates into a plausible age. No clock subscription is needed. */
function openedAge(value: unknown, now: number): { timestamp: string; age: string } | undefined {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  )
    return undefined
  const instant = Date.parse(value)
  if (
    !Number.isFinite(instant) ||
    instant > now ||
    new Date(instant).toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    return undefined
  const elapsed = Math.floor((now - instant) / 1000)
  const units = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ] as const
  for (const [seconds, unit] of units) {
    const count = Math.floor(elapsed / seconds)
    if (count > 0) return { timestamp: value, age: `${count} ${unit}${count === 1 ? '' : 's'} ago` }
  }
  return { timestamp: value, age: 'just now' }
}

function PullRequestRow({ entry, now }: { entry: Record<string, unknown>; now: number }) {
  const title = text(entry.title) || 'Title unavailable'
  const number = Number.isSafeInteger(entry.number) ? `#${entry.number}` : ''
  const author = text(supplied(entry.author, 'login'))
  const opened = openedAge(entry.createdAt, now)
  const head = text(entry.headRefName) || text(supplied(entry.head, 'ref'))
  const base = text(entry.baseRefName) || text(supplied(entry.base, 'ref'))
  const sha = text(entry.headRefOid) || text(supplied(entry.head, 'sha'))
  return (
    <article className="gh-pr-list-row">
      <div className="gh-pr-list-heading">
        <h4>
          <Link url={entry.url ?? entry.html_url}>{title}</Link>
        </h4>
        <span className="gh-pr-list-state">{stateLabel(entry)}</span>
      </div>
      <div className="gh-pr-list-meta">
        {number && <span>{number}</span>}
        {(author || opened) && (
          <span className="gh-pr-list-identity">
            {author && <span className="gh-pr-list-author">{`@${author}`}</span>}
            {author && opened && ' · '}
            {opened && (
              <time
                dateTime={opened.timestamp}
                title={`Opened ${opened.timestamp}`}
                aria-label={`Opened ${opened.timestamp}, ${opened.age}`}
              >
                {`opened ${opened.age}`}
              </time>
            )}
          </span>
        )}
        {(head || base || sha) && (
          <details className="gh-pr-list-branch">
            <summary aria-label={`Branch and commit details for ${number || title}`}>
              Details
            </summary>
            {head && (
              <p>
                From <code>{head}</code>
              </p>
            )}
            {base && (
              <p>
                Into <code>{base}</code>
              </p>
            )}
            {sha && (
              <p>
                Commit <code>{sha}</code>
              </p>
            )}
          </details>
        )}
      </div>
    </article>
  )
}

/** Historical list presentation only: no fetching, pagination or authority. */
export function PullRequestList({
  model,
  block,
  inspect,
}: Pick<CardProps, 'block' | 'inspect'> & { model: PRCardModel }) {
  const now = Date.now()
  return (
    <section className="gh-grant gh-pr-list" aria-label="GitHub Pull requests">
      <style>
        {css}
        {pullRequestListCss}
      </style>
      <h3>GitHub · Pull requests</h3>
      {model.target && <small>{model.target}</small>}
      <p role="status" className="gh-pr-list-status">
        {model.list?.summary ?? model.status}
        {model.total === undefined ? '' : ` · ${model.total} total reported`}
      </p>
      {model.error && <p role="alert">{model.error}</p>}
      {model.list?.notices.map((notice) => (
        <p role="note" key={notice}>
          {notice} See Data details.
        </p>
      ))}
      {!model.list &&
        model.warnings.map((warning, index) => (
          <p role="note" key={index}>
            {warning}
          </p>
        ))}
      <div className="gh-pr-list-results">
        {model.entries.slice(0, 5).map((entry, index) => (
          <PullRequestRow key={index} entry={entry} now={now} />
        ))}
        {model.entries.length > 5 && (
          <details className="gh-pr-list-more">
            <summary>{`Show ${model.entries.length - 5} more fetched PRs`}</summary>
            {model.entries.slice(5).map((entry, index) => (
              <PullRequestRow key={index} entry={entry} now={now} />
            ))}
          </details>
        )}
      </div>
      <details className="gh-pr-list-data">
        <summary>Data details</summary>
        {model.warnings.map((warning, index) => (
          <p key={index}>{warning}</p>
        ))}
        <details>
          <summary>Raw tool details</summary>
          <pre tabIndex={0}>{rawDetails(block) || 'No raw tool result is available yet.'}</pre>
        </details>
        {inspect && (
          <button type="button" onClick={inspect}>
            Inspect tool call
          </button>
        )}
      </details>
    </section>
  )
}

const pullRequestListCss = `
.gh-grant.gh-pr-list { background:transparent; }
.gh-pr-list > small { margin:2px 0 10px; }
.gh-pr-list .gh-pr-list-status { font-size:13px; color:var(--dsw-alias-label-secondary); margin:8px 0; }
.gh-pr-list .gh-pr-list-results { margin-top:12px; }
.gh-pr-list .gh-pr-list-row { padding:12px 0; border-top:1px solid color-mix(in srgb,var(--dsw-alias-border-standard,#8885) 65%,transparent); }
.gh-pr-list .gh-pr-list-heading { display:flex; align-items:baseline; gap:8px 12px; margin-bottom:6px; }
.gh-pr-list .gh-pr-list-row h4 { flex:1; min-width:0; margin:0; font-size:14px; line-height:1.5; font-weight:600; }
.gh-pr-list .gh-pr-list-identity { min-width:0; }
.gh-pr-list .gh-pr-list-author { color:var(--dsw-alias-label-primary); font-weight:500; }
.gh-pr-list .gh-pr-list-row h4 a { color:inherit; text-decoration:none; }
.gh-pr-list .gh-pr-list-row h4 a:hover,.gh-pr-list .gh-pr-list-row h4 a:focus-visible { color:var(--dsw-alias-brand-primary,#486ed4); text-decoration:underline; }
.gh-pr-list .gh-pr-list-meta { display:flex; flex-wrap:wrap; align-items:baseline; gap:6px 12px; color:var(--dsw-alias-label-secondary); font-size:12px; }
.gh-pr-list .gh-pr-list-state { flex-shrink:0; color:var(--dsw-alias-label-primary); font-size:12px; border:1px solid var(--dsw-alias-border-standard,#8885); border-radius:10px; padding:0 7px; }
.gh-pr-list .gh-pr-list-branch { min-width:0; margin:0; }
.gh-pr-list .gh-pr-list-branch[open] { flex-basis:100%; }
.gh-pr-list .gh-pr-list-branch p { margin:4px 0; }
.gh-pr-list .gh-pr-list-more { margin:2px 0 12px; }
.gh-pr-list .gh-pr-list-more > summary { padding:4px 0; }
.gh-pr-list .gh-pr-list-data { font-size:12px; color:var(--dsw-alias-label-secondary); margin-bottom:0; }
`
