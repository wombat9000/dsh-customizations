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
  let end = state.draft.length
  let nextEnd = draft.length
  while (end > start && nextEnd > start && state.draft[end - 1] === draft[nextEnd - 1]) {
    end--
    nextEnd--
  }
  const delta = nextEnd - end
  const selections = state.selections.flatMap((selection) => {
    if (end <= selection.start)
      return [{ ...selection, start: selection.start + delta, end: selection.end + delta }]
    if (start >= selection.end) return [selection]
    return []
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
