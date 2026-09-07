import { randomUUID } from 'node:crypto'
import { createRequestTool, createListTool, createReadTool } from './tools.js'
import { createSheetsRequestTool, createSheetsDescribeTool, createSheetsReadTool, createSheetsProposeTool, SHEETS_SKILL } from './sheets-tools.js'
import { READ_SKILL } from './skill.js'

const DISABLED = 'Google Drive tools are disabled for this session. Enable Google Drive in the session toolbar first.'

// One exact live root owns every registration. No global/standing preset tools,
// durable settings, inherited child capabilities, or file grants are created here.
export class SessionDriveTools {
  constructor({ service, agents }) {
    this.service = service
    this.agents = agents
    this.entries = new Map()
    this.closed = false
  }
  resolve(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) throw new Error('Invalid session identity.')
    const agent = this.agents.get(sessionId)
    if (this.closed || !agent || !this.agents.roots().includes(agent)) return undefined
    this.service.assertOwner(agent)
    return agent
  }
  entry(agent) {
    this.service.assertOwner(agent)
    if (this.closed) throw new Error(DISABLED)
    let entry = this.entries.get(agent)
    if (!entry) {
      entry = { agent, ownerId: randomUUID(), revision: 0, enabled: false, dispose: undefined }
      this.entries.set(agent, entry)
    }
    return entry
  }
  isEnabled(agent) { return !this.closed && this.entries.get(agent)?.enabled === true }
  revisionOf(agent) { return this.entries.get(agent)?.revision ?? 0 }
  assertEnabled(agent, revision) {
    this.service.assertOwner(agent)
    const entry = this.entries.get(agent)
    if (!this.isEnabled(agent) || (revision !== undefined && entry.revision !== revision)) throw new Error(DISABLED)
  }
  projection(entry) { return { available: true, enabled: entry.enabled, ownerId: entry.ownerId, revision: entry.revision } }
  status({ sessionId }) {
    const agent = this.resolve(sessionId)
    return agent ? this.projection(this.entry(agent)) : { available: false, enabled: false }
  }
  set({ sessionId, ownerId, revision, enabled }, signal) {
    signal?.throwIfAborted()
    const agent = this.resolve(sessionId)
    if (!agent) throw new Error('This session is not live.')
    const entry = this.entry(agent)
    if (typeof enabled !== 'boolean' || ownerId !== entry.ownerId || !Number.isSafeInteger(revision) || revision !== entry.revision) {
      throw new Error('Session tools changed. Refresh their status before trying again.')
    }
    if (entry.enabled === enabled) return this.projection(entry)
    entry.revision++
    entry.enabled = enabled
    if (!enabled) {
      entry.controller?.abort()
      // Revoke first while the disabled epoch already rejects cached executors.
      // Keep request/outcome records: OFF cannot conceal a dispatched write.
      try { this.service.revokeSession(agent) }
      finally { entry.dispose?.(); entry.dispose = undefined }
    } else {
      entry.controller = new AbortController()
      try { entry.dispose = this.install(entry) }
      catch (error) {
        entry.enabled = false; entry.revision++; entry.controller.abort()
        this.service.revokeSession(agent)
        throw error
      }
    }
    return this.projection(entry)
  }
  install(entry) {
    const { agent, revision, controller } = entry
    const tools = agent.ctx?.get('tools')
    const skills = agent.ctx?.get('skills')
    if (!tools || !skills || typeof agent.ctx?.effect !== 'function') throw new Error('Session tool and skill registries are unavailable.')
    const groups = { requests: [], drive: [], sheets: [], edits: [] }
    let active = true, unwatch
    const clearGroup = group => { for (const dispose of groups[group].splice(0).reverse()) dispose() }
    const dispose = () => {
      if (!active) return
      active = false
      unwatch?.()
      for (const group of Object.keys(groups)) clearGroup(group)
    }
    const register = (group, tool) => {
      const original = tool.execute
      groups[group].push(tools.register({ ...tool, execute: (args, exec) => {
        if (!active || exec?.agent !== agent) throw new Error(DISABLED)
        this.assertEnabled(agent, revision)
        const signal = AbortSignal.any([controller.signal, ...(exec.signal ? [exec.signal] : [])])
        return original(args, { agent, callId: exec.callId, signal })
      } }))
    }
    const update = () => {
      if (!active) return
      const granted = entry.enabled && this.service.hasAccess(agent)
      const editable = entry.enabled && this.service.hasEditAccess(agent)
      const sync = (group, enabled, install) => {
        if (!enabled) clearGroup(group)
        else if (!groups[group].length) install()
      }
      try {
        sync('drive', granted, () => {
          register('drive', createListTool(this.service)); register('drive', createReadTool(this.service))
          groups.drive.push(skills.register(READ_SKILL))
        })
        sync('sheets', granted || editable, () => {
          register('sheets', createSheetsDescribeTool(this.service)); register('sheets', createSheetsReadTool(this.service))
          groups.sheets.push(skills.register(SHEETS_SKILL))
        })
        sync('edits', editable, () => register('edits', createSheetsProposeTool(this.service)))
      } catch (error) {
        entry.enabled = false; entry.revision++; controller.abort()
        dispose()
        this.service.revokeSession(agent)
        throw error
      }
    }
    try {
      register('requests', createRequestTool(this.service))
      register('requests', createSheetsRequestTool(this.service))
      unwatch = this.service.observe(agent, update)
      entry.follow ??= agent.ctx.effect(() => () => this.service.release(agent))
      update()
      return dispose
    } catch (error) { dispose(); throw error }
  }
  release(agent) {
    const entry = this.entries.get(agent)
    if (!entry) return
    entry.enabled = false; entry.revision++; entry.controller?.abort()
    this.entries.delete(agent)
    entry.dispose?.()
    entry.follow?.()
  }
  dispose() {
    this.closed = true
    for (const agent of [...this.entries.keys()]) this.release(agent)
  }
}
