import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import { isObject } from '../../shared/contracts.js'
import { CODEX_DEVICE_URL, isDeviceCode, OAUTH_CHANNEL } from '../../shared/oauth.js'
import type { ReconnectStatus } from '../../shared/oauth.js'

interface Attempt {
  controller: AbortController
  lease: NodeJS.Timeout
  status: ReconnectStatus
}

const failure = (message: string) => ({
  ok: false as const,
  error: { code: 'invalid-request' as const, message, details: {} },
})

/** Run the native device flow for one browser attempt and keep only its public state. */
async function reconnect(
  authorization: Context['authorization'],
  key: CredentialKey,
  attempt: Attempt,
  peerSignal: AbortSignal,
) {
  const deadline = AbortSignal.timeout(16 * 60_000)
  const signal = AbortSignal.any([attempt.controller.signal, deadline, peerSignal])
  try {
    const result = await authorization.begin({
      key,
      method: 'oauth',
      signal,
      interaction: {
        async prompt(prompt) {
          signal.throwIfAborted()
          prompt.signal?.throwIfAborted()
          if (prompt.kind === 'select' && prompt.options.some(({ id }) => id === 'device_code'))
            return 'device_code'
          throw new Error('Codex device sign-in is unavailable.')
        },
        notify({ url, code }) {
          if (signal.aborted || code === undefined) return
          if (url === CODEX_DEVICE_URL && isDeviceCode(code))
            attempt.status = { phase: 'code', code }
        },
      },
    })
    attempt.status = {
      phase: deadline.aborted && result.status === 'cancelled' ? 'failed' : result.status,
    }
  } catch {
    // Provider responses may contain secrets. The browser gets a fixed failure state.
    attempt.status = { phase: 'failed' }
  }
}

/** Scope device codes and cancellation to the initiating browser's attempt handle. */
export function mountWebReconnect(ctx: Context, key: CredentialKey) {
  const connection = ctx.connection
  const attempts = new Map<string, Attempt>()
  let active: Attempt | undefined

  ctx.effect(() => {
    let closed = false
    const unregister = connection.rpc.handle(
      OAUTH_CHANNEL,
      async (endpoint, input, signal, peer) => {
        if (closed || peer !== connection.browserPeer || signal.aborted || peer.signal.aborted)
          return failure('Open Codex settings in the DSH browser to reconnect.')
        if (endpoint === 'start') {
          if (!isObject(input) || Object.keys(input).length !== 0)
            return failure('Invalid Codex sign-in request.')
          const flow = ctx.authorization.describe(key)
          if (!flow?.methods.some(({ id }) => id === 'oauth'))
            return failure('Codex sign-in is unavailable.')
          if (active || flow.inFlight) return { ok: true, value: { busy: true } }

          const id = randomUUID()
          const controller = new AbortController()
          // A closed tab or lost start response cannot hold the native flow until its full expiry.
          const lease = setTimeout(() => controller.abort(), 90_000).unref()
          const attempt: Attempt = { controller, lease, status: { phase: 'starting' } }
          active = attempt
          // Bound the number of terminal receipts. A new attempt cannot evict a pending one.
          const oldest = attempts.keys().next().value
          if (attempts.size >= 8 && oldest !== undefined) attempts.delete(oldest)
          attempts.set(id, attempt)
          void reconnect(ctx.authorization, key, attempt, peer.signal).finally(() => {
            clearTimeout(lease)
            active = undefined
          })
          return { ok: true, value: { id } }
        }

        if (!isObject(input) || typeof input.id !== 'string' || Object.keys(input).length !== 1)
          return failure('Invalid Codex sign-in request.')
        const attempt = attempts.get(input.id)
        if (!attempt) return failure('This Codex sign-in attempt has ended.')
        if (endpoint === 'status') {
          if (attempt === active && !attempt.controller.signal.aborted) attempt.lease.refresh()
          return { ok: true, value: attempt.status }
        }
        if (endpoint === 'cancel') {
          if (attempt === active && ['starting', 'code'].includes(attempt.status.phase)) {
            attempt.status = { phase: 'cancelling' }
            attempt.controller.abort()
          }
          return { ok: true, value: null }
        }
        return failure('Invalid Codex sign-in request.')
      },
    )
    return async () => {
      closed = true
      active?.controller.abort()
      attempts.clear()
      await unregister()
    }
  }, 'codex: browser reconnect')
}
