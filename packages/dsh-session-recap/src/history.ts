import { LIMITS } from './settings.js'
import type { HistoryMessage, HistoryRow } from './host-types.js'

// Only visible human/model text enters the auxiliary request. Never replay tools,
// reasoning, attachments, system instructions, or provider-private metadata.
export function boundedHistory(messages: readonly HistoryMessage[]): HistoryRow[] {
  const eligible = messages.filter(
    (message) =>
      ((message.role === 'user' && message.source?.kind === 'user') ||
        (message.role === 'assistant' && message.source?.kind === 'model')) &&
      message.content
        .slice(0, LIMITS.blocks)
        .some(
          (block) => block.type === 'text' && typeof block.text === 'string' && block.text.trim(),
        ),
  )
  if (!eligible.length) return []
  // Reserve opening and recent context; sample adjacent pairs across the middle.
  const indices = new Set<number>()
  if (eligible.length <= LIMITS.messages) {
    eligible.forEach((_, index) => indices.add(index))
  } else {
    const edge = LIMITS.messages / 4
    for (let i = 0; i < edge; i++) {
      indices.add(i)
      indices.add(eligible.length - edge + i)
    }
    const pairs = (LIMITS.messages - 2 * edge) / 2
    for (let i = 0; i < pairs; i++) {
      const index = edge + Math.floor((i * (eligible.length - 2 * edge - 2)) / (pairs - 1))
      indices.add(index)
      indices.add(index + 1)
    }
  }
  const selected = [...indices].sort((a, b) => a - b)
  let previous = -1
  const rows = selected.map((index) => {
    // Selection indices above are drawn exclusively from eligible message bounds.
    const message = eligible[index]!
    const row: HistoryRow = { role: message.role, text: historyText(message) }
    if (index > previous + 1) row.omittedBefore = index - previous - 1
    previous = index
    if (message.content.length > LIMITS.blocks) row.truncated = true
    return row
  })
  // Reserve array delimiters/commas. All allocations include serialized metadata.
  const available = LIMITS.inputBytes - 2 - (rows.length - 1)
  const sizes = rows.map(serializedBytes)
  const fairShare = Math.floor(available / rows.length)
  const budgets = sizes.map((size) => Math.min(size, fairShare))
  let spare = available - budgets.reduce((sum, budget) => sum + budget, 0)
  // Water-fill unused allowances; recent messages receive 1.5x the spare share.
  // Every selected message retains its initial allowance, regardless of age.
  // All four arrays are built with one entry per selected message; indices align.
  while (spare > 0) {
    const hungry = [...budgets.keys()].filter((i) => budgets[i]! < sizes[i]!)
    if (!hungry.length) break
    const weight = (i: number) => (selected[i]! >= eligible.length - 10 ? 3 : 2)
    const totalWeight = hungry.reduce((sum, i) => sum + weight(i), 0)
    const pool = spare
    for (const i of hungry) {
      const extra = Math.min(
        spare,
        sizes[i]! - budgets[i]!,
        Math.max(1, Math.floor((pool * weight(i)) / totalWeight)),
      )
      budgets[i] = budgets[i]! + extra
      spare -= extra
    }
  }
  return rows.map((row, i) => fitHistoryRow(row, budgets[i]!))
}

const serializedBytes = (value: HistoryRow) => Buffer.byteLength(JSON.stringify(value))
const MIDDLE_OMITTED = '\n[Middle omitted]\n'

// Retain bounded character windows before serializing: giant text blocks must not
// require a second unbounded copy. Each window alone exceeds any row's byte budget.
function historyText(message: HistoryMessage) {
  const cap = LIMITS.inputBytes
  let head = ''
  let tail = ''
  let length = 0
  for (const block of message.content.slice(0, LIMITS.blocks)) {
    if (block.type !== 'text' || typeof block.text !== 'string' || !block.text) continue
    for (const part of [length ? '\n' : '', block.text]) {
      head += part.slice(0, Math.max(0, cap - head.length))
      tail = part.length >= cap ? part.slice(-cap) : (tail + part).slice(-cap)
      length += part.length
    }
  }
  if (length <= cap) return head
  return head + tail.slice(-Math.min(cap, length - cap))
}

function historyEdges(text: string, retained: number, natural = false) {
  const headLength = Math.ceil((retained * 2) / 3)
  const tailLength = retained - headLength
  let head = text.slice(0, headLength).replace(/[\uD800-\uDBFF]$/u, '')
  let tail = tailLength ? text.slice(-tailLength).replace(/^[\uDC00-\uDFFF]/u, '') : ''
  if (natural) {
    // Prefer a nearby paragraph/sentence boundary, but surrender at most 15% of
    // either edge (and at most 80 characters). No boundary means a hard cut.
    const headFloor = head.length - Math.min(80, Math.floor(head.length * 0.15))
    const boundaries = [...head.matchAll(/\n\s*\n|[.!?](?=\s)/gu)]
    const end = boundaries.at(-1)
    if (end && end.index + end[0].length >= headFloor) {
      head = head.slice(0, end.index + end[0].length)
    }
    const start = /\n\s*\n|[.!?]\s+/u.exec(tail)
    if (start && start.index + start[0].length <= Math.min(80, Math.floor(tail.length * 0.15))) {
      tail = tail.slice(start.index + start[0].length)
    }
  }
  return head + MIDDLE_OMITTED + tail
}

function fitHistoryRow(row: HistoryRow, budget: number) {
  if (serializedBytes(row) <= budget) return row
  const shortened = { ...row, truncated: true }
  let low = 0
  let high = row.text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    shortened.text = historyEdges(row.text, middle)
    if (serializedBytes(shortened) <= budget) low = middle
    else high = middle - 1
  }
  shortened.text = historyEdges(row.text, low, true)
  return shortened
}
