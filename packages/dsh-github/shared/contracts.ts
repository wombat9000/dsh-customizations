// Narrow consumed RC2 client contracts. Tool JSON and RPC values remain unknown
// until each card's runtime validator accepts them; these are not host-wide types.
export interface ToolPart {
  type?: string | undefined
  text?: unknown
}
export interface ToolBlock {
  kind?: string | undefined
  call?: { argsRaw?: string | undefined } | undefined
  argsRaw?: string | undefined
  content?: readonly ToolPart[] | undefined
  meta?: unknown
  error?: { name?: unknown; code?: unknown } | undefined
  isError?: boolean | undefined
}
export interface PendingInteraction {
  kind: string
  callId?: string | undefined
  toolName?: string | undefined
  reason?: string | undefined
  key?: string | undefined
}
// DSH 0.2.0-rc.2 exposes pending interaction through the session-status map.
export interface SessionStatus {
  pendingInteraction: PendingInteraction | null
}
export type UseSessionStatus = <T>(selector: (map: ReadonlyMap<string, SessionStatus>) => T) => T
// RC2 nodes is a keyed reader, not a Map. Native approval only consumes values().
export type UseChat = <T>(
  selector: (snapshot: { nodes: { values(): readonly unknown[] } }) => T,
) => T
export interface TurnLocation {
  readonly turn: number
  readonly status: 'open' | 'closed' | 'unknown'
  readonly start: unknown
  readonly end: unknown
}
export interface ToolChatData {
  readonly root: unknown
}
export interface ToolTurnSource {
  getSnapshot(): readonly ToolChatData[]
  subscribe(listener: () => void): () => void
}
// Consumed surface verified in RC2 chat snapshot.d.ts and conversation.d.ts.
// The source includes hidden nodes and has stable identity per turn and kind.
export interface ActivityChatSnapshot {
  readonly nodes: {
    turnDataSource(turn: number, kind: 'tool-call'): ToolTurnSource
  }
}
export interface ActivityOverviewProps {
  sessionId: string
  turn: TurnLocation
  seq: number
  openFile: (path: string) => void
  useChat: <T>(selector: (snapshot: ActivityChatSnapshot) => T) => T
}
export interface CardEndpoints {
  status: { payload: { sessionId: string; callId: string }; result: unknown }
  revoke: { payload: { sessionId: string; callId: string; grantId: string }; result: unknown }
}
export type CardRequest = <E extends keyof CardEndpoints>(
  action: E,
  body: CardEndpoints[E]['payload'],
  signal?: AbortSignal,
) => Promise<CardEndpoints[E]['result']>
export interface CardProps {
  sessionId: string
  callId: string
  block?: ToolBlock | undefined
  inspect?: (() => void) | undefined
  useSessionStatus?: UseSessionStatus | undefined
  request?: CardRequest | undefined
}
export interface NativeApprovalDetailProps {
  sessionId: string
  callId: string
  useSessionStatus?: UseSessionStatus | undefined
  useChat?: UseChat | undefined
}
