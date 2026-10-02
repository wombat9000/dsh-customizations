import type { PickerEntry, PickerStore } from './contracts.js'
export function createPickerStore(): PickerStore {
  let value: PickerEntry | null = null
  const listeners = new Set<() => void>()
  const publish = (next: PickerEntry | null) => {
    value = next
    listeners.forEach((listener) => listener())
  }
  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    open: (next) => publish(next),
    close: () => publish(null),
    closeOwner: (owner) => {
      if (value?.owner === owner) publish(null)
    },
  }
}
