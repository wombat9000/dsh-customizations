import { CHANNEL } from '../shared/contracts.ts'
import { unwrap } from './reader.ts'
import type { CapabilityOptions } from './contracts.ts'
export function watchCapability({
  sessions,
  rpc,
  register,
  interval = setInterval,
  clear = clearInterval,
  document: doc = document,
}: CapabilityOptions) {
  let current: string | undefined
  let generation = 0
  let offTab: (() => void) | undefined
  let stopped = false
  let pending: Promise<void> | undefined
  const remove = () => {
    offTab?.()
    offTab = undefined
  }
  function check() {
    // DSH 0.2.0-rc.2 keeps selection outside the session catalog.
    // Match ui-layout's DocumentTitle: the retained main view owns selection.
    const selected = Object.values(sessions.list.getSnapshot().byId).filter(
      (session) => (session.retainedBy.mainView ?? 0) > 0,
    )
    const id = selected.length === 1 ? selected[0]!.id : undefined
    if (id !== current) {
      current = id
      generation++
      pending = undefined
      remove()
    }
    if (stopped || !id || doc.visibilityState === 'hidden' || pending) return
    const token = generation
    pending = Promise.resolve()
      .then(() => rpc.call(CHANNEL, 'capability', { sessionId: id }))
      .then((result) => {
        if (stopped || token !== generation) return
        const value = unwrap(result, id)
        if (value?.sessionId === id && value.state === 'ready') {
          if (!offTab) offTab = register(id)
        } else remove()
      })
      .catch(() => {
        if (!stopped && token === generation) remove()
      })
      .finally(() => {
        if (token === generation) pending = undefined
      })
  }
  const off = sessions.list.subscribe(check)
  const timer = interval(check, 10000)
  doc.addEventListener('visibilitychange', check)
  check()
  return () => {
    stopped = true
    generation++
    remove()
    off()
    clear(timer)
    doc.removeEventListener('visibilitychange', check)
  }
}
