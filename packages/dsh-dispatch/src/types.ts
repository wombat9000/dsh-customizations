// Narrow adapters for the DSH 0.2.2-rc.3 Host surfaces Dispatch consumes.
// Evidence for each contract is recorded in README.md ("Target contracts").
// These describe trusted in-process services, never browser- or model-supplied values.

export type Dispose = () => void

/** `@deepseek-ai/dsh-session` header fields Dispatch reads. */
export interface SessionHeader {
  readonly cwd?: string
  readonly origin?: string
  readonly delegationDepth?: number
  readonly agentPreset?: string
  readonly parentSession?: string
}

export interface SessionEventLike {
  readonly seq: number
  readonly type: string
  readonly data?: unknown
}

export interface SessionLike {
  readonly id: string
  readonly header: SessionHeader
  snapshotEvents?(): readonly SessionEventLike[]
}

/** Durable source shape declared by `@deepseek-ai/dsh-subagent` (`MessageSourceMap['agent-message']`). */
export interface AgentMessageSource {
  readonly kind: 'agent-message'
  readonly form: 'relay'
  readonly senderSessionId: string
}

export interface UserMessageLike {
  readonly role: 'user'
  readonly content: readonly { type: 'text'; text: string }[]
  readonly source: AgentMessageSource
  readonly [key: string]: unknown
}

export interface ToolsRegistry {
  register(tool: ToolDefinition): Dispose
  restrict(filter: { allow?: readonly string[]; deny?: readonly string[] }): Dispose
  guard(guard: (execution: ToolExecution) => string | undefined): Dispose
}

export interface AgentContext {
  get(key: 'tools'): ToolsRegistry | undefined
  get(key: string): unknown
  effect(effect: () => Dispose): Dispose
}

/** Live Agent (`@deepseek-ai/dsh-agent` `Agent`), consumed fields only. */
export interface AgentLike {
  readonly id: string
  readonly session: SessionLike
  readonly ctx?: AgentContext
  readonly status?: string
  /** Session-local model route (`Agent.model`); selecting here never saves the Host default. */
  readonly model?: {
    current(): Readonly<ModelSelectionLike> | undefined
    select(selection: Readonly<ModelSelectionLike>): void
  }
  /** Live pending work (`Agent.inbox`); messages keep their identity until claimed. */
  readonly inbox?: {
    readonly nextTurn: readonly { readonly id?: unknown }[]
    readonly nextStep: readonly { readonly id?: unknown }[]
  }
  followup(message: UserMessageLike): void
  steer(message: UserMessageLike): void
  whenIdle?(): Promise<void>
  /** rc.3 clears both inbox queues unless `keepInbox` is true. */
  cancel?(
    cause: { kind: 'user' } | { kind: 'hook'; reason: string },
    options?: { keepInbox?: boolean },
  ): void
}

export interface ToolExecution {
  readonly name: string
  readonly agent?: AgentLike | undefined
  readonly callId: string
  readonly signal?: AbortSignal | undefined
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: object
  output: {
    schema: object
    render(args: unknown, value: unknown): { type: 'text'; text: string }[]
  }
  execute(args: unknown, exec: ToolExecution): Promise<unknown>
}

/** `ctx.sessionController` host methods (dsh-api-session-controller 0.2.2-rc.3). */
export interface SessionControllerLike {
  create(request: {
    workspaceId?: string
    cwd?: string
    agentPreset?: string
  }): Promise<{ sessionId: string; agentPreset?: string }>
  resolveAgent(
    sessionId: string,
  ): Promise<{ readonly agent: AgentLike } | { readonly error: { message?: string } }>
}

export interface ModelSelectionLike {
  provider: string
  model: string
}

/** `ctx.llm` (dsh-llm 0.2.2-rc.3): the same validation the session controller applies. */
export interface LlmLike {
  listProviders(): readonly { id: string }[]
  listModels(provider: string): Promise<readonly { id: string }[]>
  resolveCallConfig(selection: ModelSelectionLike): Promise<unknown>
}

/** `ctx.agentDefaultModel` (dsh-agent-default-model 0.2.2-rc.3). */
export interface DefaultModelLike {
  currentSelection(): { provider: string; model: string }
}

/** `ctx.worktrees` (dsh-experimental-worktree 0.2.2-rc.3). */
export interface WorktreesLike {
  create(
    agent: AgentLike,
    request: { name?: string; from?: string },
    signal?: AbortSignal,
  ): Promise<{ path: string; branch: string; baseCommit: string; repositoryRoot: string }>
  /** Live service configuration; `retainOnArchive` is a volatile value. */
  readonly config?: { readonly retainOnArchive?: { get(): unknown } }
}

/** `ctx.workingDirectory.get(session)` returns the effective directory. */
export interface WorkingDirectoryLike {
  get(session: SessionLike): string
}

/** Connection Peer handed to RPC handlers; `owner` is the authenticated browser/API principal. */
export interface PeerLike {
  readonly principal: { readonly kind: string }
}

export type RpcHandler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
  peer: PeerLike,
) => Promise<
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details: object } }
>

export interface ConnectionLike {
  rpc: { handle(channel: string, handler: RpcHandler): () => Promise<void> }
}

/** Minimal zod-compatible validator accepted by `dsh-storage-domain` (`parse`/`safeParse`). */
export interface RecordSchema<T> {
  parse(value: unknown): T
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: Error }
}

export interface KvTableLike<V> {
  get(key: string): V | undefined
  entries(): IterableIterator<[string, V]>
  put(key: string, value: V): Promise<void>
}

export interface StorageDomainLike {
  open(spec: object): Promise<{ table(name: string): KvTableLike<unknown>; close(): Promise<void> }>
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isTopLevel(session: SessionLike): boolean {
  return session.header.origin !== 'subagent' && !((session.header.delegationDepth ?? 0) > 0)
}
