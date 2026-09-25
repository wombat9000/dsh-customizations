import React from 'react'
import { CARD_LABELS, visualCards } from '../cards.ts'
import { SelectionDetails } from './SelectionDetails.tsx'
import type { RecapCard, Selection } from '../../shared/contracts.ts'
import type { ControllerSnapshot } from '../controller-types.ts'

export interface RecapTileProps {
  card: RecapCard
}
export interface RecapBulletListProps {
  bullets: unknown
}
export interface RecapPanelProps extends Pick<
  ControllerSnapshot,
  'busy' | 'error' | 'recap' | 'selection'
> {
  diagnosticsKey?: React.Key | undefined
}
type AccentStyle = React.CSSProperties & { '--recap-accent': string }

export function RecapTile({ card }: RecapTileProps) {
  const label = CARD_LABELS[card.label]
  const accentStyle: AccentStyle = { '--recap-accent': label.accent }
  return (
    <li data-recap-card={card.label} className="dsh-session-recap-card__tile">
      <h3 className="dsh-session-recap-card__title">
        <svg
          className="dsh-session-recap-card__icon"
          style={accentStyle}
          aria-hidden={true}
          focusable="false"
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={label.path} />
        </svg>
        {label.title}
      </h3>
      <p className="dsh-session-recap-card__text">{card.text.slice(0, 180)}</p>
    </li>
  )
}

export function RecapBulletList({ bullets }: RecapBulletListProps) {
  const source: readonly unknown[] = Array.isArray(bullets) ? bullets : []
  const items = source.filter((bullet): bullet is string => typeof bullet === 'string')
  return (
    <ul className="dsh-session-recap-card__list">
      {items.map((bullet, index) => (
        <li key={index} className="dsh-session-recap-card__row">
          {bullet}
        </li>
      ))}
    </ul>
  )
}

function selectionCaption(selection: Selection | undefined) {
  if (selection?.mode !== 'standard') return null
  if (selection.reason === 'unavailable') return 'Jev unavailable'
  if (selection.reason === 'no-labels') return 'No suitable categories'
  return null
}

export function RecapPanel({ busy, error, recap, selection, diagnosticsKey }: RecapPanelProps) {
  const cards = visualCards(recap)
  const caption = selectionCaption(selection)
  return (
    <aside aria-label="Session recap" className="dsh-session-recap-card">
      {busy ? (
        <p role="status" className="dsh-session-recap-card__loading">
          Generating recap…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="dsh-session-recap-card__error">
          {error}
        </p>
      ) : null}
      {recap ? (
        <div
          tabIndex={0}
          aria-label="Recap content"
          className={`dsh-session-recap-card__body${cards.length ? ' dsh-session-recap-card__body--cards' : ''}`}
        >
          <div role={busy ? undefined : 'status'}>
            {typeof recap.headline === 'string' && recap.headline.trim() ? (
              <h2 className="dsh-session-recap-card__headline" title={recap.headline}>
                {recap.headline}
              </h2>
            ) : null}
            {cards.length ? (
              <ul role="list" aria-label="Recap cards" className="dsh-session-recap-card__grid">
                {cards.map((card) => (
                  <RecapTile key={card.label} card={card} />
                ))}
              </ul>
            ) : (
              <RecapBulletList bullets={recap.bullets} />
            )}
            {caption ? <p className="dsh-session-recap-card__caption">{caption}</p> : null}
          </div>
          {selection?.diagnostics ? (
            <SelectionDetails key={diagnosticsKey} diagnostics={selection.diagnostics} />
          ) : null}
        </div>
      ) : null}
    </aside>
  )
}
