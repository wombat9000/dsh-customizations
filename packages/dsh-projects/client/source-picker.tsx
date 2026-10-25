import React, { useEffect, useRef, useState } from 'react'
import type {
  Catalog,
  DiscoverPage,
  Request,
  SourceCandidate,
  SourceKind,
} from '../shared/contracts.ts'
import { addSources, DraftError, linkedIn, parseDraft, type Destination } from './draft.ts'
import { useTranslation } from './locale.ts'

const KINDS: { kind: SourceKind; label: string; provider: 'github' | 'linear' }[] = [
  { kind: 'github-repository', label: 'GitHub repositories', provider: 'github' },
  { kind: 'github-project', label: 'GitHub Projects', provider: 'github' },
  { kind: 'linear-project', label: 'Linear projects', provider: 'linear' },
  { kind: 'linear-team', label: 'Linear teams', provider: 'linear' },
]
const key = (candidate: SourceCandidate) => JSON.stringify(candidate.target)
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Sources are unavailable.'

// Lists sources from the connected accounts and edits the JSON draft; saving stays explicit.
export function SourcePicker({
  request,
  catalog,
  draft,
  disabled,
  onDraft,
}: {
  request: Request
  catalog: Catalog
  draft: string
  disabled: boolean
  onDraft: (draft: string) => void
}) {
  const t = useTranslation()
  const [kind, setKind] = useState<SourceKind>(
    catalog.providers.github || !catalog.providers.linear ? 'github-repository' : 'linear-project',
  )
  const [owner, setOwner] = useState('')
  const [pages, setPages] = useState<DiscoverPage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<Destination['mode'] | string>('separate')
  const [name, setName] = useState('')
  const controller = useRef<AbortController>()
  useEffect(() => () => controller.current?.abort(), [])
  const github = kind.startsWith('github-')
  const candidates = pages.flatMap((page) => page.candidates)
  const last = pages.at(-1)
  let parsed: ReturnType<typeof parseDraft> | undefined
  try {
    parsed = parseDraft(draft)
  } catch {
    parsed = undefined
  }

  async function load(cursor?: string) {
    controller.current?.abort()
    const current = (controller.current = new AbortController())
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const page = await request(
        'discover',
        {
          kind,
          ...(github && owner.trim() ? { owner: owner.trim() } : {}),
          ...(cursor ? { cursor } : {}),
        },
        current.signal,
      )
      if (current.signal.aborted) return
      setPages((pages) => (cursor ? [...pages, page] : [page]))
      if (!cursor) setPicked(new Set())
    } catch (error) {
      if (!current.signal.aborted) setError(message(error))
    } finally {
      if (!current.signal.aborted) setLoading(false)
    }
  }
  function reset(next: SourceKind) {
    controller.current?.abort()
    setKind(next)
    setPages([])
    setPicked(new Set())
    setError('')
    setNotice('')
    setLoading(false)
  }
  function add() {
    setError('')
    setNotice('')
    try {
      const config = parseDraft(draft)
      const picks = candidates.filter((candidate) => picked.has(key(candidate)))
      const destination: Destination =
        mode === 'separate'
          ? { mode: 'separate' }
          : mode === 'combined'
            ? { mode: 'combined', name }
            : { mode: 'existing', projectId: mode.slice('existing:'.length) }
      onDraft(JSON.stringify(addSources(config, picks, destination), null, 2))
      setPicked(new Set())
      setNotice(
        `${t('Added to the draft:')} ${picks.length.toLocaleString()}. ${t('Review the JSON, then save local settings.')}`,
      )
    } catch (error) {
      setError(error instanceof DraftError ? t(error.message) : message(error))
    }
  }

  return (
    <details open>
      <summary>{t('Add from your accounts')}</summary>
      <p>
        {t(
          'Lists what your connected GitHub and Linear accounts can see. Selected sources are added to the draft below; nothing is saved until you save local settings.',
        )}
      </p>
      <nav>
        <label>
          {t('Source type')}{' '}
          <select
            value={kind}
            disabled={disabled}
            onChange={(event) => reset(event.target.value as SourceKind)}
          >
            {KINDS.map((option) => (
              <option key={option.kind} value={option.kind}>
                {t(option.label)}
                {!catalog.providers[option.provider] && ` (${t('unavailable')})`}
              </option>
            ))}
          </select>
        </label>
        {github && (
          <label>
            {t('Owner')}{' '}
            <input
              value={owner}
              disabled={disabled}
              placeholder={t('Your account')}
              onChange={(event) => setOwner(event.target.value)}
              spellCheck={false}
            />
          </label>
        )}
        <button disabled={disabled || loading} onClick={() => void load()}>
          {loading && !pages.length ? t('Finding sources…') : t('Find sources')}
        </button>
      </nav>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {last && (
        <>
          {last.owner && (
            <p>
              <small>
                {t('Owner:')} {last.owner}
              </small>
            </p>
          )}
          {!candidates.length ? (
            <p>{t('No sources found.')}</p>
          ) : (
            <ul className="local-projects-candidates" aria-label={t('Available sources')}>
              {candidates.map((candidate) => {
                const id = key(candidate)
                const linked = parsed ? linkedIn(parsed, candidate.target) : []
                return (
                  <li key={id}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={picked.has(id)}
                        onChange={(event) =>
                          setPicked((picked) => {
                            const next = new Set(picked)
                            if (event.target.checked) next.add(id)
                            else next.delete(id)
                            return next
                          })
                        }
                      />{' '}
                      {candidate.name}
                    </label>
                    {candidate.inactive && <small> · {t('Closed or archived')}</small>}
                    {!!linked.length && (
                      <small>
                        {' '}
                        · {t('Already in:')} {linked.join(', ')}
                      </small>
                    )}
                    {candidate.description && (
                      <>
                        <br />
                        <small>{candidate.description}</small>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {last.hasNextPage && last.nextCursor && (
            <button disabled={disabled || loading} onClick={() => void load(last.nextCursor)}>
              {loading ? t('Loading more…') : t('Load more')}
            </button>
          )}
          {!!candidates.length && (
            <nav>
              <label>
                {t('Add as')}{' '}
                <select
                  value={mode}
                  disabled={disabled}
                  onChange={(event) => setMode(event.target.value)}
                >
                  <option value="separate">{t('One new project per source')}</option>
                  <option value="combined">{t('One new project with all selected')}</option>
                  {parsed?.projects.map((project) => (
                    <option key={project.id} value={`existing:${project.id}`}>
                      {t('Add to')} {project.name}
                    </option>
                  ))}
                </select>
              </label>
              {mode === 'combined' && (
                <label>
                  {t('Project name')}{' '}
                  <input
                    value={name}
                    disabled={disabled}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              )}
              <button disabled={disabled || !picked.size} onClick={add}>
                {t('Add selected to draft')}
              </button>
            </nav>
          )}
        </>
      )}
    </details>
  )
}
