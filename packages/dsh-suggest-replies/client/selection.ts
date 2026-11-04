interface Selection {
  reply: string
  start: number
  end: number
}
export interface SelectionState {
  draft: string
  selections: readonly Selection[]
}

// Track only unchanged text we inserted. Edits through a suggestion turn it into
// ordinary draft text; never guess which user-authored words should be deleted.
export function reconcileSelection(state: SelectionState, draft: string): SelectionState {
  if (state.draft === draft) return state
  let start = 0
  while (start < state.draft.length && start < draft.length && state.draft[start] === draft[start])
    start++
  const shorter = Math.min(state.draft.length, draft.length)
  let suffix = 0
  while (suffix < shorter && state.draft.at(-1 - suffix) === draft.at(-1 - suffix)) suffix++
  const delta = draft.length - state.draft.length
  // Repeated text can make prepending and appending indistinguishable. Compare
  // both extreme minimal edit alignments; retain ownership only if they agree.
  const leftStart = Math.min(start, shorter - suffix)
  const rightEnd = state.draft.length - Math.min(suffix, shorter - start)
  const leftEnd = state.draft.length - suffix
  function map(selection: Selection, editStart: number, editEnd: number) {
    if (editEnd <= selection.start)
      return { ...selection, start: selection.start + delta, end: selection.end + delta }
    if (editStart >= selection.end) return selection
    return undefined
  }
  const selections = state.selections.flatMap((selection) => {
    const left = map(selection, leftStart, leftEnd)
    const right = map(selection, start, rightEnd)
    return left && right && left.start === right.start && left.end === right.end ? [left] : []
  })
  return { draft, selections }
}

export function toggleSelection(state: SelectionState, reply: string): SelectionState {
  const selected = state.selections.find((selection) => selection.reply === reply)
  if (selected) {
    // If the first item disappears, also consume the next item's owned newline.
    // Never remove a separator typed by the user.
    const end =
      selected.start === 0 &&
      state.selections.some(
        (selection) => selection.start === selected.end && state.draft[selection.start] === '\n',
      )
        ? selected.end + 1
        : selected.end
    const removed = end - selected.start
    return {
      draft: state.draft.slice(0, selected.start) + state.draft.slice(end),
      selections: state.selections
        .filter((selection) => selection !== selected)
        .map((selection) =>
          selection.start >= selected.end
            ? {
                ...selection,
                start: Math.max(selected.start, selection.start - removed),
                end: selection.end - removed,
              }
            : selection,
        ),
    }
  }
  const addition = `${state.draft && !state.draft.endsWith('\n') ? '\n' : ''}${reply}`
  return {
    draft: state.draft + addition,
    selections: [
      ...state.selections,
      { reply, start: state.draft.length, end: state.draft.length + addition.length },
    ],
  }
}
