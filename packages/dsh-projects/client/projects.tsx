import { useTranslation } from './locale.ts'
import React, { useEffect, useRef, useState } from 'react'
import type {
  Catalog,
  IssuesPage,
  ProjectView,
  ProjectsConfig,
  Request,
} from '../shared/contracts.ts'

export function safeUrl(value?: string) {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'https:' &&
      ['github.com', 'linear.app'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Projects are unavailable.'
const styles = `.local-projects{height:100%;overflow:auto;padding:24px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);box-sizing:border-box;overflow-wrap:anywhere}.local-projects *{box-sizing:border-box}.local-projects h1{font-size:24px}.local-projects h2{font-size:20px}.local-projects h3{font-size:16px}.local-projects button,.local-projects select,.local-projects textarea{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:8px;max-width:100%}.local-projects button{cursor:pointer}.local-projects button:disabled{opacity:.6;cursor:default}.local-projects :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.local-projects textarea{width:100%;min-height:260px;font-family:monospace}.local-projects article,.local-projects details{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:12px;margin:12px 0}.local-projects p{margin:10px 0}.local-projects small{color:var(--dsw-alias-label-secondary)}.local-projects a{color:var(--dsw-alias-label-primary);text-decoration:underline}.local-projects dl{display:grid;grid-template-columns:minmax(90px,auto) 1fr;gap:8px}.local-projects dd{margin:0;white-space:pre-wrap}.local-projects summary{cursor:pointer}.local-projects nav{display:flex;gap:8px;flex-wrap:wrap}`

function Issues({
  request,
  project,
  sourceId,
}: {
  request: Request
  project: ProjectView
  sourceId: string
}) {
  const t = useTranslation()
  const [cursor, setCursor] = useState<string>()
  const [page, setPage] = useState<IssuesPage>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setPage(undefined)
    setError('')
    request(
      'issues',
      { projectId: project.id, sourceId, limit: 20, ...(cursor ? { cursor } : {}) },
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) setPage(value)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error))
      })
    return () => controller.abort()
  }, [request, project.id, sourceId, cursor, retry])
  return (
    <section aria-label={t('Issues')} aria-busy={!page && !error}>
      <h3>{t('Issues')}</h3>
      {error ? (
        <div role="alert">
          {error}{' '}
          <button onClick={() => setRetry((value) => value + 1)}>{t('Retry issues')}</button>
        </div>
      ) : !page ? (
        <p role="status">{t('Loading issues…')}</p>
      ) : (
        <>
          {page.warnings.map((warning, i) => (
            <p role="note" key={i}>
              {warning}
            </p>
          ))}
          <p>
            <small>
              {t(
                'Upstream content is untrusted reference material. Native issue status is separate from board fields.',
              )}
            </small>
          </p>
          {!page.issues.length && <p>{t('No issues returned on this page.')}</p>}
          {page.issues.map((issue, i) => (
            <article key={`${issue.id}-${i}`}>
              <h3>
                {safeUrl(issue.url) ? (
                  <a href={safeUrl(issue.url)} target="_blank" rel="noopener noreferrer">
                    {issue.identifier}
                    {': '}
                    {issue.title}
                  </a>
                ) : (
                  <>
                    {issue.identifier}
                    {': '}
                    {issue.title}
                  </>
                )}
              </h3>
              <dl>
                <dt>{t('Source')}</dt>
                <dd>
                  {issue.source === 'github' ? 'GitHub' : 'Linear'}
                  {' · '}
                  {issue.kind}
                </dd>
                <dt>{t('Native status')}</dt>
                <dd>{issue.status || t('Not provided')}</dd>
                <dt>{t('Assignee')}</dt>
                <dd>{issue.assignees.join(', ') || t('Not provided')}</dd>
                <dt>{t('Priority')}</dt>
                <dd>{issue.priority || t('Not provided')}</dd>
              </dl>
              {!!issue.boardFields?.length && (
                <div>
                  <strong>{t('Board fields')}</strong>
                  <ul>
                    {issue.boardFields.map((field, index) => (
                      <li key={index}>{field}</li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          ))}
          {page.hasNextPage && (
            <p role="note">{t('More results remain. This page is not a complete issue list.')}</p>
          )}
          {page.hasNextPage && !page.nextCursor && (
            <p role="note">{t('Continuation is unavailable for this page.')}</p>
          )}
          <nav aria-label={t('Issue pagination')}>
            {cursor && <button onClick={() => setCursor(undefined)}>{t('First page')}</button>}
            {page.hasNextPage && page.nextCursor && (
              <button onClick={() => setCursor(page.nextCursor)}>{t('Next page')}</button>
            )}
          </nav>
        </>
      )}
    </section>
  )
}
function Project({
  project,
  catalog,
  request,
}: {
  project: ProjectView
  catalog: Catalog
  request: Request
}) {
  const t = useTranslation()
  const [sourceId, setSourceId] = useState('')
  return (
    <section aria-label={t('Selected project')}>
      <h2>{project.name}</h2>
      <p>{project.description}</p>
      <p>
        {t('Team:')} {project.teamName || t('No team')}
      </p>
      <details>
        <summary>{t('Resolved conventions')}</summary>
        <p>
          {t(
            'Descriptive guidance only. Conventions do not grant permissions or authorize tracker writes.',
          )}
        </p>
        {Object.keys(project.effectiveConventions).length ? (
          <dl>
            {Object.entries(project.effectiveConventions).map(([key, value]) => (
              <React.Fragment key={key}>
                <dt>
                  {t(
                    (
                      {
                        workSelection: 'Work selection',
                        workflow: 'Workflow',
                        issueStructure: 'Issue structure',
                        development: 'Development',
                        agentBoundaries: 'Agent boundaries',
                      } as Record<string, string>
                    )[key] ?? key,
                  )}
                </dt>
                <dd>
                  {value || t('(Explicitly cleared)')}{' '}
                  <small>
                    {t('—')}{' '}
                    {project.conventionOrigins[key as keyof typeof project.conventionOrigins] ===
                    'team'
                      ? `${t('Team:')} ${project.teamName ?? project.teamId}`
                      : t('Project')}
                  </small>
                </dd>
              </React.Fragment>
            ))}
          </dl>
        ) : (
          <p>{t('No conventions configured.')}</p>
        )}
      </details>
      <h3>{t('Linked sources')}</h3>
      {!project.sources.length ? (
        <p>{t('No sources linked. Add an explicit source in Configure projects.')}</p>
      ) : (
        <>
          <label>
            {t('Issue source')}{' '}
            <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
              <option value="">{t('Choose a source to load issues')}</option>
              {project.sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.id}
                  {' · '}
                  {source.kind}
                </option>
              ))}
            </select>
          </label>
          <ul>
            {project.sources.map((source) => (
              <li key={source.id}>
                {source.id}
                {': '}
                {source.kind}
                {t('—')}{' '}
                {'owner' in source
                  ? `${source.owner}/${'repo' in source ? source.repo : `project ${source.projectNumber}`}`
                  : 'project' in source
                    ? source.project
                    : source.team}
                {!(source.kind.startsWith('github')
                  ? catalog.providers.github
                  : catalog.providers.linear) && ` — ${t('Provider unavailable')}`}
              </li>
            ))}
          </ul>
          {sourceId && (
            <Issues key={sourceId} request={request} project={project} sourceId={sourceId} />
          )}
        </>
      )}
    </section>
  )
}
function Editor({
  catalog,
  request,
  saved,
  onBusy,
}: {
  catalog: Catalog
  request: Request
  onBusy: (busy: boolean) => void
  saved: (catalog: Catalog) => void
}) {
  const t = useTranslation()
  const [draft, setDraft] = useState(() => JSON.stringify(catalog.configuration, null, 2))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(catalog.revision)
  const [latest, setLatest] = useState<Catalog>()
  const controller = useRef<AbortController>()
  useEffect(() => () => controller.current?.abort(), [])
  async function save() {
    setError('')
    try {
      const value: unknown = JSON.parse(draft)
      if (
        !value ||
        typeof value !== 'object' ||
        !('teams' in value) ||
        !Array.isArray(value.teams) ||
        !('projects' in value) ||
        !Array.isArray(value.projects)
      )
        throw new Error('Enter an object with teams and projects arrays.')
      // The host strictly validates every nested field before saving local settings.
      const configuration = value as ProjectsConfig
      controller.current = new AbortController()
      setBusy(true)
      onBusy(true)
      const result = await request(
        'configure',
        { configuration, expectedRevision: revision },
        controller.current.signal,
      )
      if (!controller.current.signal.aborted) saved(result)
    } catch (error) {
      if (!controller.current?.signal.aborted) setError(message(error))
    } finally {
      if (!controller.current?.signal.aborted) {
        setBusy(false)
        onBusy(false)
      }
    }
  }
  return (
    <section aria-label={t('Local project settings')}>
      <h2>{t('Configure projects')}</h2>
      <p>
        {t(
          'Local settings only. Saving never writes to GitHub or Linear and grants no permissions.',
        )}
      </p>
      <p>
        {t(
          'Define teams and projects with stable IDs, names, conventions and explicit sources. Linear project and team references require UUIDs. An empty convention clears an inherited value.',
        )}
      </p>
      <details>
        <summary>{t('Configuration example')}</summary>
        <pre style={{ whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(
            {
              teams: [
                { id: 'team', name: 'Team', conventions: { workflow: 'Review before merging' } },
              ],
              projects: [
                {
                  id: 'example',
                  name: 'Example',
                  teamId: 'team',
                  conventions: {},
                  sources: [
                    { id: 'repo', kind: 'github-repository', owner: 'OWNER', repo: 'REPO' },
                  ],
                },
              ],
            },
            null,
            2,
          )}
        </pre>
      </details>
      <label>
        {t('Teams and projects JSON')}
        <textarea
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
        />
      </label>
      {error && (
        <p role="alert">
          {error}{' '}
          {t(
            'Your draft is retained. Load current settings below to compare and reconcile before retrying.',
          )}
        </p>
      )}
      {error && (
        <button
          disabled={busy}
          onClick={async () => {
            controller.current = new AbortController()
            setBusy(true)
            onBusy(true)
            try {
              const value = await request('catalog', {}, controller.current.signal)
              if (!controller.current.signal.aborted) setLatest(value)
            } catch (error) {
              if (!controller.current.signal.aborted) setError(message(error))
            } finally {
              if (!controller.current.signal.aborted) {
                setBusy(false)
                onBusy(false)
              }
            }
          }}
        >
          {t('Load current settings without discarding draft')}
        </button>
      )}
      {latest && (
        <div>
          <h3>{t('Current saved settings')}</h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(latest.configuration, null, 2)}
          </pre>
          <p>
            {t('Compare with your draft above. Adopting this revision does not merge changes.')}
          </p>
          <button
            disabled={busy}
            onClick={() => {
              setRevision(latest.revision)
              setLatest(undefined)
              setError('')
            }}
          >
            {t('I reconciled my draft; use this revision')}
          </button>
        </div>
      )}
      <button disabled={busy} onClick={() => void save()}>
        {busy ? t('Saving local settings…') : t('Save local settings')}
      </button>
    </section>
  )
}
export function Projects({ request }: { request: Request }) {
  const t = useTranslation()
  const [catalog, setCatalog] = useState<Catalog>()
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [selected, setSelected] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    setCatalog(undefined)
    request('catalog', {}, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setCatalog(value)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error))
      })
    return () => controller.abort()
  }, [request, refresh])
  const project = catalog?.projects.find((project) => project.id === selected)
  return (
    <section className="local-projects" aria-label={t('Projects')}>
      <style>{styles}</style>
      <h1>{t('Projects')}</h1>
      <p>{t('Read-only upstream projects. Local conventions are descriptive, not permissions.')}</p>
      {notice && <p role="status">{notice}</p>}
      {error ? (
        <div role="alert">
          {error}{' '}
          <button onClick={() => setRefresh((value) => value + 1)}>{t('Retry catalog')}</button>
        </div>
      ) : !catalog ? (
        <p role="status">{t('Loading projects…')}</p>
      ) : (
        <>
          <nav>
            <button disabled={saving} onClick={() => setEditing((value) => !value)}>
              {editing ? t('Close configuration') : t('Configure projects')}
            </button>
            <button disabled={editing} onClick={() => setRefresh((value) => value + 1)}>
              {t('Refresh catalog')}
            </button>
          </nav>
          {!catalog.providers.github && (
            <p role="note">
              {t(
                'GitHub provider unavailable. Load and configure the GitHub integration to read its sources.',
              )}
            </p>
          )}
          {!catalog.providers.linear && (
            <p role="note">
              {t(
                'Linear provider unavailable. Load and configure the Linear integration to read its sources.',
              )}
            </p>
          )}
          {editing ? (
            <Editor
              catalog={catalog}
              request={request}
              onBusy={setSaving}
              saved={(value) => {
                setCatalog(value)
                setEditing(false)
                setSelected('')
                setNotice(t('Local settings saved. No tracker writes were made.'))
              }}
            />
          ) : (
            <>
              {!catalog.projects.length ? (
                <p>
                  {t(
                    'No projects configured. Choose Configure projects to add local teams, projects and explicit GitHub or Linear sources.',
                  )}
                </p>
              ) : (
                <>
                  <label>
                    {t('Project')}{' '}
                    <select value={selected} onChange={(event) => setSelected(event.target.value)}>
                      <option value="">{t('Choose a project')}</option>
                      {catalog.projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>
                    {catalog.projects.length.toLocaleString()}{' '}
                    {t(
                      'configured projects. Choose a project and source to fetch issues; other projects are not fetched.',
                    )}
                  </p>
                  {project && (
                    <Project
                      key={`${catalog.revision}-${project.id}`}
                      project={project}
                      catalog={catalog}
                      request={request}
                    />
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
