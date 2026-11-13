import { randomUUID } from 'node:crypto'
import { DispatchError } from './contracts.js'
import type {
  AgentLike,
  AgentMessageSource,
  LlmLike,
  SessionControllerLike,
  SessionEventLike,
  UserMessageLike,
  WorkingDirectoryLike,
} from './types.js'
import { isRecord, isTopLevel } from './types.js'

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const field of Object.values(value)) deepFreeze(field)
    Object.freeze(value)
  }
  return value
}

/**
 * Build one user-role message attributed to another Agent. Mirrors
 * `createUserMessage` from `@deepseek-ai/dsh-llm` 0.2.2-rc.3 (structured clone,
 * fresh UUID identity, deep freeze) without a runtime dependency, and uses the
 * `agent-message` source that `@deepseek-ai/dsh-subagent` registers. The sender
 * is always the exact live executing Agent; callers cannot supply it.
 */
export function agentMessage(
  sender: AgentLike,
  heading: string,
  body: string,
  id: string = randomUUID(),
): UserMessageLike {
  const source: AgentMessageSource = {
    kind: 'agent-message',
    form: 'relay',
    senderSessionId: sender.id,
  }
  return deepFreeze(
    structuredClone({
      role: 'user' as const,
      content: [{ type: 'text' as const, text: heading ? `${heading}\n\n${body}` : body }],
      source,
      id,
    }),
  )
}

export interface HistoryItem {
  readonly seq: number
  readonly type: string
  readonly role?: string
  readonly sender?: string
  readonly text: string
}

const TEXT_LIMIT = 4_000

function eventText(event: SessionEventLike): HistoryItem | undefined {
  const data = event.data
  if (!isRecord(data)) return undefined
  const message = isRecord(data.message) ? data.message : data
  const content = Array.isArray(message.content) ? message.content : []
  const text = content
    .map((part: unknown) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
  if (!text) return undefined
  const source = isRecord(message.source)
    ? message.source
    : isRecord(data.source)
      ? data.source
      : {}
  return {
    seq: event.seq,
    type: event.type,
    ...(typeof message.role === 'string' ? { role: message.role } : {}),
    ...(source.kind === 'agent-message' && typeof source.senderSessionId === 'string'
      ? { sender: source.senderSessionId }
      : {}),
    text: text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text,
  }
}

/** Ordinary-session access through public 0.2.2-rc.3 Host services. */
export class Sessions {
  private readonly controller: () => SessionControllerLike | undefined
  private readonly directories: () => WorkingDirectoryLike | undefined
  private readonly llm: () => LlmLike | undefined
  constructor(
    controller: () => SessionControllerLike | undefined,
    directories: () => WorkingDirectoryLike | undefined,
    llm: () => LlmLike | undefined = () => undefined,
  ) {
    this.controller = controller
    this.directories = directories
    this.llm = llm
  }

  private requireController() {
    const controller = this.controller()
    if (!controller)
      throw new DispatchError('unavailable', 'The DSH session controller is not available.')
    return controller
  }

  async create(input: { cwd: string; preset: string }) {
    const result = await this.requireController().create({
      cwd: input.cwd,
      agentPreset: input.preset,
    })
    if (result.agentPreset !== undefined && result.agentPreset !== input.preset)
      throw new DispatchError(
        'uncertain',
        `The session was created with preset ${result.agentPreset}, not ${input.preset}.`,
      )
    return result.sessionId
  }

  /**
   * Pin one worker's model through its own `Agent.model`, after the same
   * availability and route checks the session controller applies. Unlike
   * `sessionController.selectModel`, this never saves the Host default model.
   */
  async selectModel(agent: AgentLike, model: string) {
    const [provider, ...rest] = model.split('/')
    const id = rest.join('/')
    if (!provider || !id) throw new DispatchError('invalid', 'Name the model as provider/model.')
    const llm = this.llm()
    if (!llm || !agent.model)
      throw new DispatchError('unavailable', 'This DSH build cannot select a session-local model.')
    if (!llm.listProviders().some((entry) => entry.id === provider))
      throw new DispatchError('unavailable', `Model provider ${provider} is not available.`)
    if (!(await llm.listModels(provider)).some((entry) => entry.id === id))
      throw new DispatchError('unavailable', `Model ${model} is not available.`)
    const selection = { provider, model: id }
    await llm.resolveCallConfig(selection)
    agent.model.select(selection)
    const current = agent.model.current()
    if (current?.provider !== provider || current.model !== id)
      throw new DispatchError(
        'uncertain',
        `The worker runs ${current ? `${current.provider}/${current.model}` : 'no model'}, not the approved ${model}.`,
      )
  }

  /** Resolve (resuming if necessary) one top-level ordinary session. */
  async resolve(sessionId: string): Promise<AgentLike> {
    const result = await this.requireController().resolveAgent(sessionId)
    if ('error' in result)
      throw new DispatchError('not-found', result.error.message ?? 'The session is unavailable.')
    if (!isTopLevel(result.agent.session))
      throw new DispatchError('ineligible', 'Only top-level ordinary sessions can be managed.')
    return result.agent
  }

  effectiveDirectory(agent: AgentLike): string | undefined {
    return this.directories()?.get(agent.session) ?? undefined
  }

  deliver(recipient: AgentLike, message: UserMessageLike, mode: 'queue' | 'steer') {
    if (mode === 'steer') recipient.steer(message)
    else recipient.followup(message)
  }

  /** Bounded, paginated, text-only history. Reads the committed log; never activates work. */
  history(agent: AgentLike, cursor: number | undefined, limit: number) {
    const events = agent.session.snapshotEvents?.() ?? []
    const items: HistoryItem[] = []
    let next: number | undefined
    for (const event of events) {
      if (cursor !== undefined && event.seq <= cursor) continue
      if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
      const item = eventText(event)
      if (!item) continue
      if (items.length === limit) {
        next = items[items.length - 1]!.seq
        break
      }
      items.push(item)
    }
    return { items, ...(next !== undefined ? { cursor: next } : {}), truncated: next !== undefined }
  }

  /**
   * Whether this message identity was already admitted: still pending in the
   * live inbox, recorded by a durable `agent/inbox/spliced` insertion (queued
   * or steered), or committed as a message. A canceled splice still counts:
   * the coordinator's user discarded it, and Dispatch does not resend it.
   */
  hasMessage(agent: AgentLike, messageId: string) {
    const pending = [...(agent.inbox?.nextTurn ?? []), ...(agent.inbox?.nextStep ?? [])]
    if (pending.some((message) => message.id === messageId)) return true
    for (const event of agent.session.snapshotEvents?.() ?? []) {
      const data = event.data
      if (!isRecord(data)) continue
      if (event.type === 'agent/inbox/spliced') {
        const inserted = Array.isArray(data.inserted) ? data.inserted : []
        if (inserted.some((message) => isRecord(message) && message.id === messageId)) return true
        continue
      }
      const message = isRecord(data.message) ? data.message : data
      if (message.id === messageId) return true
    }
    return false
  }

  /** Whether the Agent is idle with nothing queued or steering. */
  quiescent(agent: AgentLike) {
    return (
      (agent.status === undefined || agent.status === 'idle') &&
      (agent.inbox?.nextTurn.length ?? 0) === 0 &&
      (agent.inbox?.nextStep.length ?? 0) === 0
    )
  }
}
