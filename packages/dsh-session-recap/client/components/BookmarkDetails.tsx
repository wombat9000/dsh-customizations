import React from 'react'
import type { BookmarkDiagnostics, BookmarkStatus } from '../../shared/bookmarks.ts'

const statuses: Record<BookmarkStatus, string> = {
  proposed: 'Proposed (not approved)',
  accepted: 'Accepted by user',
  open: 'Open',
  answered: 'Answer present',
  completed: 'Completion reported',
  superseded: 'Superseded or abandoned',
}

export function BookmarkDetails({ diagnostics }: { diagnostics: BookmarkDiagnostics }) {
  const [notice, setNotice] = React.useState('')
  React.useEffect(() => {
    setNotice('')
  }, [diagnostics])
  const json = JSON.stringify(diagnostics, null, 2)
  async function copy() {
    try {
      await navigator.clipboard.writeText(json)
      setNotice('Bookmark diagnostics copied.')
    } catch {
      setNotice('Clipboard unavailable. Expand the JSON and copy it manually.')
    }
  }
  return (
    <details className="dsh-session-recap-card__diagnostics">
      <summary>Bookmark details</summary>
      <p>
        Evidence markers for Next steps and Open questions. Statuses are model judgments, not
        verified task outcomes.
      </p>
      <p>
        Model: {diagnostics.model ?? 'Unavailable'} · Questions: {diagnostics.questionSetVersion}
      </p>
      <p>
        State: {diagnostics.status} · Messages processed: {diagnostics.processedMessages}
      </p>
      <p>
        Source IDs identify the supporting messages. Excerpts stay host-side; this export contains
        no conversation text or credentials. Opening or copying makes no model call.
      </p>
      {diagnostics.items.length ? (
        <div
          className="dsh-session-recap-card__table-wrap"
          tabIndex={0}
          aria-label="Session bookmarks"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Source message</th>
                <th scope="col">Speaker</th>
                <th scope="col">Status</th>
                <th scope="col">Support</th>
                <th scope="col">Latest update</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.items.map((item) => (
                <tr key={item.id}>
                  <th scope="row">{item.kind === 'next_step' ? 'Next step' : 'Open question'}</th>
                  <td>{item.messageId}</td>
                  <td>{item.role}</td>
                  <td>{statuses[item.status]}</td>
                  <td>{item.support}</td>
                  <td>
                    {item.updatedByMessageId ?? '—'}
                    {item.transitionScore === undefined ? '' : ` (${item.transitionScore})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No retained bookmarks. The standard recap remains available.</p>
      )}
      <button
        type="button"
        onClick={() => {
          void copy()
        }}
      >
        Copy bookmark diagnostics JSON
      </button>
      {notice ? <p role="status">{notice}</p> : null}
      <details>
        <summary>Bookmark diagnostics JSON</summary>
        <pre tabIndex={0} aria-label="Bookmark diagnostics JSON">
          {json}
        </pre>
      </details>
    </details>
  )
}
