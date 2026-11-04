export interface DeliveryState {
  turn: number
  phase: 'pending' | 'sent' | 'error'
}

// One owner per session, retained by the plugin rather than its mounted view.
// Native direct-send admission has no composer pending echo. A successful RPC
// must stay latched until another turn supplies suggestions, even after remount.
export function createDelivery(admit: (reply: string) => Promise<void>) {
  let state: DeliveryState | undefined
  const listeners = new Set<() => void>()
  function publish(next: DeliveryState) {
    state = next
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async send(reply: string, turn: number) {
      if (state?.phase === 'pending' || (state?.turn === turn && state.phase === 'sent')) return
      publish({ turn, phase: 'pending' })
      try {
        await admit(reply)
        publish({ turn, phase: 'sent' })
      } catch (error) {
        // Do not retry: rejection can arrive after Host admission. The view
        // explains this uncertainty before any deliberate manual retry.
        publish({ turn, phase: 'error' })
        throw error
      }
    },
  }
}
