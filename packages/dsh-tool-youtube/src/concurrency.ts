export type ConcurrencyGate = <T>(task: () => Promise<T>) => Promise<T>

export function linkedAbortController(signal?: AbortSignal) {
  const controller = new AbortController()
  const forwardAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) forwardAbort()
  else signal?.addEventListener('abort', forwardAbort, { once: true })
  return {
    controller,
    dispose: () => signal?.removeEventListener('abort', forwardAbort),
  }
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onError?: (error: unknown) => void,
) {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  let firstError: unknown
  const runWorker = async () => {
    while (firstError === undefined) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      try {
        // The bounds check above establishes that this indexed item exists.
        results[index] = await worker(items[index]!, index)
      } catch (error) {
        if (firstError === undefined) {
          firstError = error
          onError?.(error)
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker))
  if (firstError !== undefined) throw firstError
  return results
}

export function createConcurrencyGate(limit: number): ConcurrencyGate {
  let active = 0
  const waiting: (() => void)[] = []
  const acquire = () =>
    new Promise<void>((resolve) => {
      if (active < limit) {
        active += 1
        resolve()
      } else {
        waiting.push(resolve)
      }
    })
  const release = () => {
    const next = waiting.shift()
    if (next === undefined) active -= 1
    else next()
  }
  return async <T>(task: () => Promise<T>) => {
    await acquire()
    try {
      return await task()
    } finally {
      release()
    }
  }
}
