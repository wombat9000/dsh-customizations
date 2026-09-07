import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'sandbox-callback-publisher'
const require = createRequire(import.meta.url)
const PACKAGE = '@local/dsh-sbx-bridge'
const unavailable = () => new Error('Sandbox callback publishing is unavailable. Configure the optional sandbox bridge.')
const cancelled = () => new Error('Sandbox callback publishing was cancelled.')
const failed = () => new Error('Could not publish the sandbox callback port. Check the sandbox bridge helper.')

function originFrom(result) {
  const value = result?.url
  // Accept only the bridge's explicit IPv4 loopback HTTP origin, never a
  // callback path, credentials, query, fragment, or provider-controlled host.
  if (typeof value !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(value)) throw failed()
  const url = new URL(value)
  const port = Number(value.slice(value.lastIndexOf(':') + 1))
  if (port > 65535 || (result.hostPort !== undefined && result.hostPort !== port)) throw failed()
  if (url.hostname !== '127.0.0.1') throw failed()
  return value
}

export class SandboxCallbackPublisher {
  constructor({ bridgeDir, env = process.env,
    loadBridge = () => import('@local/dsh-sbx-bridge'),
    resolveBridge = () => require.resolve(PACKAGE),
  } = {}) {
    this.bridgeDir = bridgeDir ?? join(env.DSH_HOME || join(homedir(), '.dsh'), 'sbx-bridge')
    this.loadBridge = loadBridge
    this.resolveBridge = resolveBridge
    this.lifecycle = new AbortController()
    this.pending = new Set()
    this.leases = new Set()
  }

  available() {
    if (this.lifecycle.signal.aborted || typeof this.bridgeDir !== 'string' || !this.bridgeDir.trim()) return false
    try { return typeof this.resolveBridge() === 'string' } catch { return false }
  }

  // The caller's signal cancels setup only. Once returned, the caller owns
  // release timing so it can flush callback responses before closing the relay.
  async publish({ port, signal } = {}) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid sandbox callback port.')
    const combined = AbortSignal.any([this.lifecycle.signal, signal].filter(Boolean))
    if (combined.aborted) throw cancelled()
    if (!this.available()) throw unavailable()
    let onAbort
    const abort = new Promise((_, reject) => {
      onAbort = () => reject(cancelled())
      combined.addEventListener('abort', onAbort, { once: true })
    })
    const operation = this.open(port, combined)
    this.pending.add(operation)
    operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation))
    try { return await Promise.race([operation, abort]) }
    catch (error) {
      // Cancellation can win after open produced a lease but before delivery.
      void operation.then(lease => lease.dispose()).catch(() => {})
      throw error
    }
    finally { combined.removeEventListener('abort', onAbort) }
  }

  async open(port, signal) {
    let client
    let release
    try {
      const module = await this.loadBridge()
      if (signal.aborted) throw cancelled()
      client = new module.BridgeClient({ bridgeDir: this.bridgeDir })
      let cleanup
      release = () => {
        if (!cleanup) {
          cleanup = (async () => {
            let error = false
            try { await client.close(port) } catch { error = true }
            finally {
              try { await client.dispose() } catch { error = true }
              this.leases.delete(release)
            }
            if (error) throw new Error('Could not release the sandbox callback publication.')
          })()
        }
        return cleanup
      }
      const result = await client.open({ port, name: 'Google OAuth callback' }, signal)
      if (signal.aborted) throw cancelled()
      const origin = originFrom(result)
      this.leases.add(release)
      return { origin, dispose: release }
    } catch {
      if (release) await release().catch(() => {})
      throw signal.aborted ? cancelled() : failed()
    }
  }

  dispose() {
    if (!this.stopping) {
      this.lifecycle.abort()
      this.stopping = (async () => {
        // Keep pending work until it settles even if a bridge ignores abort.
        await Promise.allSettled([...this.pending])
        await Promise.allSettled([...this.leases].map(release => release()))
      })()
    }
    return this.stopping
  }
}

export function apply(ctx, config = {}) {
  const publisher = new SandboxCallbackPublisher(config)
  ctx.provide('sandboxCallbackPublisher', Object.freeze({
    available: () => publisher.available(),
    publish: args => publisher.publish(args),
  }))
  ctx.effect(() => () => publisher.dispose())
}
