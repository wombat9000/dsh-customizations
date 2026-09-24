import React from 'react'
import { CARD_LABELS } from '../cards.ts'
import type { SelectionCategory, SelectionDiagnostics, SelectionThresholds } from '../../shared/contracts.ts'

export interface SelectionTableProps {
  categories: readonly SelectionCategory[]
  thresholds: SelectionThresholds
}
export interface SelectionDetailsViewProps {
  diagnostics: SelectionDiagnostics
  json: string
  copyStatus: string
  onCopy: React.MouseEventHandler<HTMLButtonElement>
}
export interface SelectionDetailsProps { diagnostics?: SelectionDiagnostics | null | undefined }

export function SelectionTable({ categories, thresholds }: SelectionTableProps) {
  const format = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
    ? String(Number(value.toFixed(3)))
    : '—'
  const reasons = {
    support: `support below ${thresholds.support}`,
    usefulness: `usefulness below ${thresholds.usefulness}`,
    confidence: `confidence below ${thresholds.confidence}`,
    'invalid-answer': 'answer incomplete or invalid',
    'ranked-out': `outside the top ${thresholds.maxCards}`,
  }
  return <div
    className="dsh-session-recap-card__table-wrap"
    tabIndex={0}
    aria-label="Category selection scores"
  >
    <table>
      <thead><tr>
        {['Category', 'Support', 'Usefulness', 'Confidence', 'Outcome'].map(title =>
          <th key={title} scope="col">{title}</th>)}
      </tr></thead>
      <tbody>{categories.map(row => {
        const outcome = row.selected ? 'Selected' : row.reasons.length
          ? `Not selected: ${row.reasons.map(reason => reasons[reason] ?? 'not evaluated').join('; ')}`
          : 'Not evaluated'
        return <tr key={row.label}>
          <th scope="row">{CARD_LABELS[row.label]?.title ?? row.label}</th>
          <td>{format(row.support)}</td>
          <td>{format(row.usefulness)}</td>
          <td>{format(row.confidence)}</td>
          <td>{outcome}</td>
        </tr>
      })}</tbody>
    </table>
  </div>
}

export function SelectionDetailsView({ diagnostics, json, copyStatus, onCopy }: SelectionDetailsViewProps) {
  const thresholds = diagnostics.thresholds
  return <details className="dsh-session-recap-card__diagnostics">
    <summary>Selection details</summary>
    <p>From this recap request. Opening or copying these details makes no model call. No conversation text or credentials are included.</p>
    <p>{`Model: ${diagnostics.model ?? 'Unavailable'} · Questions: ${diagnostics.questionSetVersion}`}</p>
    <p>{`Thresholds: support ≥ ${thresholds.support}; usefulness ≥ ${thresholds.usefulness}; confidence ≥ ${thresholds.confidence}. Up to ${thresholds.maxCards} cards.`}</p>
    {diagnostics.status === 'unavailable'
      ? <p>Jev evaluation was unavailable; no category scores were retained.</p>
      : <p>Table values are rounded to three decimals. JSON keeps full precision. Selected categories go to the writer, which can still omit a card.</p>}
    <SelectionTable categories={diagnostics.categories} thresholds={thresholds} />
    <button type="button" onClick={onCopy}>Copy diagnostics JSON</button>
    {copyStatus ? <p role="status">{copyStatus}</p> : null}
    <details>
      <summary>Questions, probabilities, and JSON</summary>
      <p>Question wording and rubric levels for this request, with full-precision values when evaluation succeeded:</p>
      <pre tabIndex={0} aria-label="Selection diagnostics JSON">{json}</pre>
    </details>
  </details>
}

export function SelectionDetails({ diagnostics }: SelectionDetailsProps) {
  const [copyStatus, setCopyStatus] = React.useState('')
  React.useEffect(() => { setCopyStatus('') }, [diagnostics])
  if (diagnostics?.version !== 1) return null
  // Export only this host-allowlisted snapshot, never enclosing recap/session state.
  const json = JSON.stringify(diagnostics, null, 2)
  async function copy() {
    try {
      await navigator.clipboard.writeText(json)
      setCopyStatus('Diagnostics copied.')
    } catch {
      setCopyStatus('Clipboard unavailable. Expand the JSON and copy it manually.')
    }
  }
  return <SelectionDetailsView
    diagnostics={diagnostics}
    json={json}
    copyStatus={copyStatus}
    onCopy={copy}
  />
}
