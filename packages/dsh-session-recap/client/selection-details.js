// React and CARD_LABELS come from the enclosing client factory.
function SelectionDetails({ diagnostics }) {
  const h = React.createElement
  const [copyStatus, setCopyStatus] = React.useState('')
  React.useEffect(() => { setCopyStatus('') }, [diagnostics])
  if (diagnostics?.version !== 1) return null
  // The host constructs this allowlisted snapshot without history or provider errors.
  // Export this snapshot only, never the enclosing recap or session state.
  const json = JSON.stringify(diagnostics, null, 2)
  const thresholds = diagnostics.thresholds
  const format = value => typeof value === 'number' && Number.isFinite(value)
    ? String(Number(value.toFixed(3)))
    : '—'
  const reasons = {
    support: `support below ${thresholds.support}`,
    usefulness: `usefulness below ${thresholds.usefulness}`,
    confidence: `confidence below ${thresholds.confidence}`,
    'invalid-answer': 'answer incomplete or invalid',
    'ranked-out': `outside the top ${thresholds.maxCards}`,
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(json)
      setCopyStatus('Diagnostics copied.')
    } catch {
      setCopyStatus('Clipboard unavailable. Expand the JSON and copy it manually.')
    }
  }

  function renderCategory(row) {
    const outcome = row.selected ? 'Selected' : row.reasons.length
      ? `Not selected: ${row.reasons.map(reason => reasons[reason] ?? 'not evaluated').join('; ')}`
      : 'Not evaluated'
    return h('tr', { key: row.label },
      h('th', { scope: 'row' }, CARD_LABELS[row.label]?.title ?? row.label),
      h('td', null, format(row.support)),
      h('td', null, format(row.usefulness)),
      h('td', null, format(row.confidence)),
      h('td', null, outcome))
  }

  return h('details', { className: 'dsh-session-recap-card__diagnostics' },
    h('summary', null, 'Selection details'),
    h('p', null, 'From this recap request. Opening or copying these details makes no model call. No conversation text or credentials are included.'),
    h('p', null, `Model: ${diagnostics.model ?? 'Unavailable'} · Questions: ${diagnostics.questionSetVersion}`),
    h('p', null, `Thresholds: support ≥ ${thresholds.support}; usefulness ≥ ${thresholds.usefulness}; confidence ≥ ${thresholds.confidence}. Up to ${thresholds.maxCards} cards.`),
    diagnostics.status === 'unavailable'
      ? h('p', null, 'Jev evaluation was unavailable; no category scores were retained.')
      : h('p', null, 'Table values are rounded to three decimals. JSON keeps full precision. Selected categories go to the writer, which can still omit a card.'),
    h('div', { className: 'dsh-session-recap-card__table-wrap', tabIndex: 0, 'aria-label': 'Category selection scores' },
      h('table', null,
        h('thead', null, h('tr', null,
          ...['Category', 'Support', 'Usefulness', 'Confidence', 'Outcome'].map(title => h('th', { key: title, scope: 'col' }, title)))),
        h('tbody', null, ...diagnostics.categories.map(renderCategory)))),
    h('button', { type: 'button', onClick: copy }, 'Copy diagnostics JSON'),
    copyStatus ? h('p', { role: 'status' }, copyStatus) : null,
    h('details', null,
      h('summary', null, 'Questions, probabilities, and JSON'),
      h('p', null, 'Question wording and rubric levels for this request, with full-precision values when evaluation succeeded:'),
      h('pre', { tabIndex: 0, 'aria-label': 'Selection diagnostics JSON' }, json)))
}
