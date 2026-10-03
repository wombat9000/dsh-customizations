import { createHash } from 'node:crypto'
import type { CICheckout, CISnapshot, SessionCIRequest, SessionCISnapshot } from './types.js'

export const CI_CHECKOUT_COMMAND = `git rev-parse --show-toplevel 2>/dev/null || exit 1
printf '__DSH_CI_HEAD__\\n'
git rev-parse --verify 'HEAD^{commit}' 2>/dev/null || printf '\\n'
printf '__DSH_CI_BRANCH__\\n'
git symbolic-ref --quiet --short HEAD 2>/dev/null || printf '\\n'
printf '__DSH_CI_REMOTES__\\n'
git remote -v || exit 1`

// Narrow managed Shell/session adapter. No host cwd or unmanaged git is used.
export interface CIHost {
  sessions: { get(id: string): { header: { cwd?: string } } | undefined }
  probe(cwd: string, signal: AbortSignal): Promise<string | null>
  github():
    { readCheckout(checkout: CICheckout, signal: AbortSignal): Promise<CISnapshot> } | undefined
}
export function checkoutIdentity(
  cwd: string,
  text: string,
): { checkout: CICheckout; key: string } | null {
  const match =
    /^([^\n]+)\n__DSH_CI_HEAD__\n([^\n]*)\n__DSH_CI_BRANCH__\n([^\n]*)\n__DSH_CI_REMOTES__\n([\s\S]*)$/.exec(
      text,
    )
  if (!match || !match[1] || (match[2] && !/^[a-f0-9]{40}$/i.test(match[2]))) return null
  const remotes: string[] = []
  const lines = match[4]!.split('\n').filter(Boolean)
  if (lines.length > 100) return null
  for (const line of lines) {
    const remote = /^\S+\s+(.+)\s+\((?:fetch|push)\)$/.exec(line)
    if (!remote?.[1]) return null
    remotes.push(remote[1])
  }
  const checkout = {
    cwd,
    root: match[1],
    head: match[2] || null,
    branch: match[3] || null,
    remotes: [...new Set(remotes)].sort(),
  }
  return { checkout, key: createHash('sha256').update(JSON.stringify(checkout)).digest('hex') }
}
export async function probeCheckout(host: CIHost, sessionId: string, signal: AbortSignal) {
  const session = host.sessions.get(sessionId)
  const cwd = session?.header.cwd
  if (!session || !cwd || signal.aborted) return null
  const text = await host.probe(cwd, signal)
  if (
    signal.aborted ||
    host.sessions.get(sessionId) !== session ||
    session.header.cwd !== cwd ||
    text === null
  )
    return null
  return checkoutIdentity(cwd, text)
}
export async function readSessionCI(
  host: CIHost,
  request: SessionCIRequest,
  signal: AbortSignal,
): Promise<SessionCISnapshot> {
  const unavailable = (error: string): SessionCISnapshot => ({
    checkoutKey: request.checkoutKey,
    rows: [],
    checkedAt: Date.now(),
    freshUntil: Date.now(),
    refreshAfterMs: 30000,
    error,
    stale: false,
  })
  const session = host.sessions.get(request.sessionId)
  try {
    const identity = await probeCheckout(host, request.sessionId, signal)
    if (!identity || identity.key !== request.checkoutKey)
      return unavailable('Checkout changed; waiting for local Git read')
    const github = host.github()
    if (!github) return unavailable('GitHub integration unavailable')
    const snapshot = await github.readCheckout(identity.checkout, signal)
    const current = await probeCheckout(host, request.sessionId, signal)
    if (
      signal.aborted ||
      host.sessions.get(request.sessionId) !== session ||
      current?.key !== identity.key
    )
      return unavailable('Checkout changed; CI result discarded')
    return { ...snapshot, checkoutKey: identity.key }
  } catch {
    return unavailable(signal.aborted ? 'CI read cancelled' : 'CI unavailable')
  }
}
