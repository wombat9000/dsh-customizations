import React from 'react'
import type { ToolBlock } from '../shared/contracts.ts'
import { object, text, rawDetails } from './validation.ts'
import { Link } from './common.tsx'
import { css, itemCss, issueCss } from './styles.ts'
import {
  connectionTitles,
  itemFieldModel,
  projectItemModel,
  readCardModel,
  shortIdentity,
  supplied,
  type ReadCardModel,
} from './read-models.ts'

export function TextSection({ title, value }: { title: string; value: unknown }) {
  return typeof value === 'string' && value.length > 0 ? (
    <details>
      <summary>{title}</summary>
      <pre tabIndex={0}>{value}</pre>
    </details>
  ) : null
}

export function SuppliedList({ title, connection }: { title: string; connection: unknown }) {
  if (!object(connection)) return null
  if (!Array.isArray(connection.nodes))
    return <p>{`${title}: malformed supplied details; inspect raw data.`}</p>
  return (
    <details>
      <summary>{`${title} (${connection.nodes.length} returned${Number.isSafeInteger(connection.totalCount) ? `; ${connection.totalCount} total reported` : ''})`}</summary>
      <ul>
        {connection.nodes.slice(0, 50).map((entry: unknown, index: number) => (
          <li key={index}>
            {object(entry) ? (
              <Link
                url={entry.url}
              >{`${Number.isSafeInteger(entry.number) ? `#${entry.number} — ` : ''}${shortIdentity(entry)}`}</Link>
            ) : (
              'Malformed entry — see raw details'
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}

export function FieldValue({ value }: { value: unknown }) {
  const model = itemFieldModel(value)
  return (
    <li>
      <strong>{`${model.label}: `}</strong>
      <Link url={model.url}>{model.value}</Link>
      {model.connections?.map((key) => (
        <SuppliedList key={key} title={connectionTitles[key]} connection={supplied(value, key)} />
      ))}
    </li>
  )
}

export function ProjectItem({ entry }: { entry: Record<string, unknown> }) {
  const model = projectItemModel(entry)
  return (
    <article className="gh-item">
      <div className="gh-item-head">
        <div>
          <h4>
            <Link
              url={model.url}
            >{`${model.number === undefined ? '' : `#${model.number} — `}${model.title}`}</Link>
          </h4>
          {model.repositories.map((repository) => (
            <small key={repository.nameWithOwner}>
              <Link url={repository.url}>{repository.nameWithOwner}</Link>
            </small>
          ))}
          {model.type !== 'Issue' && <small>{model.type || 'Content unavailable'}</small>}
          {entry.isArchived === true && <small>Archived</small>}
        </div>
        <p>Issue state: {model.issueState}</p>
        <p>Board status: {model.boardStatus}</p>
      </div>
      {model.prs.map((value, index) => {
        const nodes = supplied(supplied(value, 'pullRequests'), 'nodes')
        return (
          <div key={index} className="gh-item-pr">
            {'Linked PRs: '}
            {!Array.isArray(nodes)
              ? 'Not supplied or malformed'
              : nodes.length === 0
                ? 'None returned'
                : nodes.slice(0, 50).map((pr: unknown, i: number) => (
                    <React.Fragment key={i}>
                      {i > 0 && ' · '}
                      <Link
                        url={supplied(pr, 'url')}
                      >{`${Number.isSafeInteger(supplied(pr, 'number')) ? `#${supplied(pr, 'number')} — ` : ''}${text(supplied(pr, 'title')) || 'Title not supplied'}`}</Link>
                    </React.Fragment>
                  ))}
          </div>
        )
      })}
      <details>
        <summary
          aria-label={`Additional fields for ${model.number === undefined ? model.title : `item #${model.number}`}`}
        >
          Additional fields
        </summary>
        {entry.fieldValues === undefined ? (
          <p>Fields not supplied.</p>
        ) : model.fields.length ? (
          <ul className="gh-item-fields">
            {model.fields.map((value, index) => (
              <FieldValue key={index} value={value} />
            ))}
          </ul>
        ) : (
          <p>No additional fields returned.</p>
        )}
        <TextSection title="Item description" value={supplied(entry.content, 'body')} />
        <details>
          <summary>Technical details</summary>
          <pre tabIndex={0}>{JSON.stringify(entry, null, 2)}</pre>
        </details>
      </details>
    </article>
  )
}

export function IssueRow({
  entry,
  sharedRepository,
}: {
  entry: Record<string, unknown>
  sharedRepository?: string
}) {
  const state = entry.state === 'OPEN' ? 'Open' : entry.state === 'CLOSED' ? 'Closed' : 'Unknown'
  return (
    <section className="gh-issue">
      <div className="gh-issue-head">
        <h4>
          <Link url={entry.url}>{`#${entry.number} — ${entry.title}`}</Link>
        </h4>
        <span
          className="gh-issue-state"
          aria-label={`Issue state: ${state}`}
        >{`Issue: ${state}`}</span>
      </div>
      {!sharedRepository && (
        <small>
          {text(supplied(entry.repository, 'nameWithOwner')) || 'Repository unavailable'}
        </small>
      )}
    </section>
  )
}

export function IssueCollection({
  title,
  connection,
  compact,
  incomplete,
}: {
  title: string
  connection: unknown
  compact?: boolean
  incomplete?: boolean
}) {
  if (!object(connection) || !Array.isArray(connection.nodes))
    return <p role="note">{`${title}: details missing or malformed; completeness unknown.`}</p>
  const complete =
    !incomplete &&
    supplied(connection.pageInfo, 'hasNextPage') === false &&
    !connection.nextCursor &&
    connection.truncated !== true &&
    connection.totalCount === connection.nodes.length
  if (!connection.nodes.length)
    return complete ? null : (
      <p role="note">{`${title}: no entries returned; completeness unknown.`}</p>
    )
  return (
    <div className="gh-issue-collection">
      <strong>{`${title}: `}</strong>
      <span className={compact ? 'gh-issue-chips' : ''}>
        {connection.nodes.slice(0, 50).map((entry: unknown, index: number) => (
          <span key={index} className={compact ? 'gh-issue-chip' : 'gh-issue-related'}>
            {object(entry) ? (
              <Link
                url={entry.url}
              >{`${text(supplied(entry.repository, 'nameWithOwner')) ? `${supplied(entry.repository, 'nameWithOwner')} ` : ''}${Number.isSafeInteger(entry.number) ? `#${entry.number} — ` : ''}${text(entry.name) || text(entry.login) || text(entry.title) || 'Name unavailable'}`}</Link>
            ) : (
              'Malformed entry — see raw details'
            )}
          </span>
        ))}
      </span>
      {!complete && (
        <small>{`${title}: completeness unknown; inspect pagination and raw details.`}</small>
      )}
    </div>
  )
}

const issueCollections: readonly { title: string; key: string; compact: boolean }[] = [
  { title: 'Labels', key: 'labels', compact: true },
  { title: 'Assignees', key: 'assignees', compact: true },
  { title: 'Sub-issues', key: 'subIssues', compact: false },
  { title: 'Blocked by', key: 'blockedBy', compact: false },
  { title: 'Blocking', key: 'blocking', compact: false },
]

export function IssueDetail({
  entry,
  model,
}: {
  entry: Record<string, unknown>
  model: ReadCardModel
}) {
  // Localized truncation does not invalidate other explicitly complete collections.
  const incomplete = (key: string): boolean =>
    Boolean(
      model.unlocalizedTruncation ||
      model.truncationPaths?.some(
        (path) => path === 'data' || path === `data.${key}` || path.startsWith(`data.${key}.`),
      ) ||
      model.warnings.some(
        (warning) =>
          warning.startsWith(`data.${key}:`) ||
          warning.startsWith(`data.${key}.`) ||
          warning.includes('inspection bound'),
      ),
    )
  const body = entry.body,
    long = typeof body === 'string' && body.length > 400
  return (
    <>
      <IssueRow entry={entry} />
      {typeof body !== 'string' ? (
        <p role="note">Description unavailable.</p>
      ) : body === '' ? (
        <p className="gh-note">No description.</p>
      ) : (
        <div className="gh-issue-description">
          <p style={{ whiteSpace: 'pre-wrap' }}>{long ? `${body.slice(0, 400)}…` : body}</p>
          {long && (
            <details>
              <summary>Full description — preview shortened</summary>
              <div style={{ whiteSpace: 'pre-wrap' }}>{body}</div>
            </details>
          )}
        </div>
      )}
      {entry.parent === null ? null : object(entry.parent) ? (
        <p>
          {'Parent: '}
          <Link
            url={entry.parent.url}
          >{`${text(supplied(entry.parent.repository, 'nameWithOwner')) ? `${supplied(entry.parent.repository, 'nameWithOwner')} ` : ''}${Number.isSafeInteger(entry.parent.number) ? `#${entry.parent.number} — ` : ''}${text(entry.parent.title) || 'Title unavailable'}`}</Link>
        </p>
      ) : (
        <p role="note">Parent: details missing or malformed.</p>
      )}
      {issueCollections.map(({ title, key, compact }) => (
        <IssueCollection
          key={key}
          title={title}
          connection={entry[key]}
          compact={compact}
          incomplete={incomplete(key)}
        />
      ))}
    </>
  )
}

function FieldDefinition({ field }: { field: Record<string, unknown> }) {
  return (
    <section>
      <strong>{`${shortIdentity(field)} (${text(field.dataType) || 'type unavailable'})`}</strong>
      <small>{`Field ID: ${text(field.id) || 'unavailable'}`}</small>
      {Array.isArray(field.options) && (
        <ul>
          {field.options.slice(0, 50).map((option: unknown, i: number) => (
            <li
              key={i}
            >{`${shortIdentity(option)} — ID: ${text(supplied(option, 'id')) || 'unavailable'}`}</li>
          ))}
        </ul>
      )}
      {['iterations', 'completedIterations'].map((key) => {
        const iterations = supplied(field.configuration, key)
        return (
          Array.isArray(iterations) && (
            <div key={key}>
              <p>{key === 'iterations' ? 'Active iterations' : 'Completed iterations'}</p>
              <ul>
                {iterations.slice(0, 50).map((iteration: unknown, i: number) => (
                  <li
                    key={i}
                  >{`${shortIdentity(iteration)}; ID: ${text(supplied(iteration, 'id')) || 'unavailable'}; ${text(supplied(iteration, 'startDate'))}`}</li>
                ))}
              </ul>
            </div>
          )
        )
      })}
    </section>
  )
}

export function ReadEntry({
  entry,
  kind,
}: {
  entry: Record<string, unknown>
  kind: ReadCardModel['kind']
}) {
  if (kind === 'items') return <ProjectItem entry={entry} />
  const project = kind === 'projects',
    fields = supplied(entry.fields, 'nodes')
  return (
    <section>
      <h4>
        <Link
          url={entry.url}
        >{`${project ? 'Project' : 'Issue'} #${entry.number} — ${entry.title}`}</Link>
      </h4>
      <small>{`ID: ${entry.id}${text(supplied(entry.repository, 'nameWithOwner')) ? `; Repository: ${supplied(entry.repository, 'nameWithOwner')}` : ''}${text(supplied(entry.owner, 'login')) ? `; Owner: ${supplied(entry.owner, 'login')}` : ''}`}</small>
      <p>
        {project
          ? `Project: ${entry.closed === true ? 'closed' : entry.closed === false ? 'open' : 'state unavailable'}; ${entry.template === true ? 'template' : entry.template === false ? 'not a template' : 'template status unavailable'}`
          : `Issue state: ${text(entry.state) || 'unavailable'} (not board Status)`}
      </p>
      {text(entry.shortDescription) && <p>{text(entry.shortDescription)}</p>}
      <TextSection
        title={project ? 'Project README' : 'Issue description'}
        value={project ? entry.readme : entry.body}
      />
      {project ? (
        <>
          <SuppliedList title="Linked repositories" connection={entry.repositories} />
          {entry.fields !== undefined && (
            <details>
              <summary>Project field definitions</summary>
              {Array.isArray(fields) ? (
                fields
                  .slice(0, 50)
                  .map((field: unknown, index: number) =>
                    object(field) ? (
                      <FieldDefinition key={index} field={field} />
                    ) : (
                      <p key={index}>Malformed field — inspect raw details</p>
                    ),
                  )
              ) : (
                <p>Field definitions unavailable.</p>
              )}
            </details>
          )}
        </>
      ) : (
        <>
          {Boolean(entry.parent) && (
            <p>
              {'Parent: '}
              <Link
                url={supplied(entry.parent, 'url')}
              >{`#${supplied(entry.parent, 'number') ?? '?'} — ${shortIdentity(entry.parent)}`}</Link>
            </p>
          )}
          {issueCollections.map(({ title, key }) => (
            <SuppliedList key={key} title={title} connection={entry[key]} />
          ))}
        </>
      )}
    </section>
  )
}

export interface ReadCardProps {
  toolName: string
  block?: ToolBlock | undefined
  inspect?: (() => void) | undefined
}
export function ReadCard({ toolName, block, inspect }: ReadCardProps) {
  const model = readCardModel(toolName, block)
  const issueList = model.kind === 'issues' && !model.singular,
    issueDetail = model.kind === 'issues' && model.singular
  const repositories = model.entries.map((entry) =>
    text(supplied(entry.repository, 'nameWithOwner')),
  )
  const sharedRepository =
    repositories.length && repositories[0] && repositories.every((name) => name === repositories[0])
      ? repositories[0]
      : ''
  return (
    <section
      className={`gh-grant${model.kind === 'items' ? ' gh-items' : model.kind === 'issues' ? ' gh-issues' : ''}`}
      aria-label={`GitHub ${model.title}`}
    >
      <style>
        {css}
        {model.kind === 'items' ? itemCss : model.kind === 'issues' ? issueCss : ''}
      </style>
      {model.kind === 'items' && <small>Historical tool result · no automatic refresh</small>}
      {!issueDetail && <h3>{`GitHub · ${model.title}`}</h3>}
      {!issueDetail && (
        <p role="status">
          {model.state === 'running'
            ? 'Reading…'
            : model.state === 'returned'
              ? `${model.returnedCount} ${model.singular ? 'entry' : 'entries'} returned${model.total === undefined ? '' : `; ${model.total} total reported${model.totalMeaning ? ` (${model.totalMeaning})` : ''}`}`
              : 'Result unavailable'}
        </p>
      )}
      {model.error && <p role="alert">{model.error}</p>}
      {model.warnings.map((warning, index) => (
        <p key={index} role="note">
          {warning}
        </p>
      ))}
      {model.templateOnly && (
        <p>{`Template filtering applies only to this page${Number.isSafeInteger(model.scannedCount) ? `; ${model.scannedCount} projects scanned` : ''}. An empty page does not imply no templates exist.`}</p>
      )}
      {model.state === 'returned' && model.entries.length === 0 && (
        <p>No entries returned on this page.</p>
      )}
      {issueList && sharedRepository && <p className="gh-note">{sharedRepository}</p>}
      {model.entries.map((entry, index) =>
        issueList ? (
          <IssueRow key={index} entry={entry} sharedRepository={sharedRepository} />
        ) : issueDetail ? (
          <IssueDetail key={index} entry={entry} model={model} />
        ) : (
          <ReadEntry key={index} entry={entry} kind={model.kind} />
        ),
      )}
      <details>
        <summary>Raw tool details</summary>
        <pre tabIndex={0}>{rawDetails(block) || 'No raw tool result is available yet.'}</pre>
        {typeof inspect === 'function' && (
          <button type="button" onClick={inspect}>
            Inspect tool call
          </button>
        )}
      </details>
    </section>
  )
}
