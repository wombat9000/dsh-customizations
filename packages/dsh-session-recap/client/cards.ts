import type { RecapCard } from '../shared/contracts.ts'

// Fixed card vocabulary shared by recap rendering and selection diagnostics.
// Only these local labels, paths and accents may shape a generated card.
export const CARD_LABELS = Object.freeze({
  direction: { title: 'Direction', path: 'm5 19 4-10 10-4-4 10-10 4Zm4-10 6 6', accent: '#628bc4' },
  decision: { title: 'Decision', path: 'm5 12 4 4L19 6M5 21h14', accent: '#548d78' },
  insight: {
    title: 'Key insight',
    path: 'M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 2H9l-1-2Z',
    accent: '#b18a48',
  },
  question: {
    title: 'Open question',
    path: 'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 4h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
    accent: '#9680b8',
  },
  next_step: { title: 'Next step', path: 'M4 12h16m-6-6 6 6-6 6', accent: '#588e9e' },
  paused: { title: 'Where we paused', path: 'M8 5v14M16 5v14', accent: '#a38273' },
})

export function visualCards(recap: { readonly cards?: unknown } | null | undefined): RecapCard[] {
  const seen = new Set<string>()
  const cards: readonly unknown[] = Array.isArray(recap?.cards) ? recap.cards : []
  return cards
    .filter((card): card is RecapCard => {
      if (
        !card ||
        (typeof card !== 'object' && typeof card !== 'function') ||
        !('label' in card) ||
        typeof card.label !== 'string' ||
        !Object.hasOwn(CARD_LABELS, card.label) ||
        !('text' in card) ||
        typeof card.text !== 'string' ||
        !card.text.trim() ||
        seen.has(card.label)
      )
        return false
      seen.add(card.label)
      return true
    })
    .slice(0, 3)
}
