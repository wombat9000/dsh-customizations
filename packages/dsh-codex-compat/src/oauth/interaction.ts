export function waitForAbort(signal: AbortSignal | undefined): Promise<string> {
  if (!signal)
    return Promise.reject(new Error('Headless Codex callback prompts require cancellation.'))
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}
