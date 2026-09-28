// Text-free wire diagnostics; evidence passages stay host-side until recap writing.
export type BookmarkKind = 'next_step' | 'question'
export type BookmarkStatus =
  'proposed' | 'accepted' | 'open' | 'answered' | 'completed' | 'superseded'
export interface BookmarkDiagnosticItem {
  readonly id: string
  readonly messageId: string
  readonly kind: BookmarkKind
  readonly role: 'user' | 'assistant'
  readonly status: BookmarkStatus
  readonly support: number
  readonly transitionScore?: number
  readonly updatedByMessageId?: string
}
export interface BookmarkDiagnostics {
  readonly version: 1
  readonly questionSetVersion: string
  readonly model: string | null
  readonly status: 'ready' | 'unavailable' | 'pending'
  readonly processedMessages: number
  readonly items: readonly BookmarkDiagnosticItem[]
}
