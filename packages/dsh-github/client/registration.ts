import type { ComponentType } from 'react'
import type { CardProps, NativeApprovalDetailProps } from '../shared/contracts.ts'
import { NativeApprovalDetail } from './approval-components.tsx'
import { GrantCard } from './grant-card.tsx'
import { FieldChangeCard } from './field-card.tsx'
import { ReadCard } from './read-components.tsx'
import { READ_TOOLS } from './read-models.ts'
import { TOOL } from './grant-model.ts'
import { FIELD_TOOL } from './field-model.ts'
// The published RC2 composed slot declarations are incomplete; keep this adapter
// limited to the two established seats, matching the existing registrations.
interface GitHubSeats {
  'conversation.approval.detail': NativeApprovalDetailProps
  'tool.call.toolview': CardProps & { toolName: string }
}
type Registration<K extends keyof GitHubSeats> = K extends 'conversation.approval.detail'
  ? { name: K; priority: number }
  : { name: K; key: string }
export interface GitHubRegistrationContext {
  slots: {
    inject<K extends keyof GitHubSeats>(name: K, register: () => unknown): unknown
    register<K extends keyof GitHubSeats>(
      options: Registration<K>,
      component: ComponentType<GitHubSeats[K]>,
    ): () => void
  }
}
export function apply(ctx: GitHubRegistrationContext) {
  // Single seat: unmatched requests retain the native command fallback and reason.
  ctx.slots.inject('conversation.approval.detail', () =>
    ctx.slots.register<'conversation.approval.detail'>(
      { name: 'conversation.approval.detail', priority: -10 },
      NativeApprovalDetail,
    ),
  )
  ctx.slots.inject('tool.call.toolview', () => {
    const disposers = [
      ctx.slots.register<'tool.call.toolview'>(
        { name: 'tool.call.toolview', key: TOOL },
        GrantCard,
      ),
      ctx.slots.register<'tool.call.toolview'>(
        { name: 'tool.call.toolview', key: FIELD_TOOL },
        FieldChangeCard,
      ),
      ...READ_TOOLS.map((key) =>
        ctx.slots.register<'tool.call.toolview'>({ name: 'tool.call.toolview', key }, ReadCard),
      ),
    ]
    return () => {
      for (const dispose of disposers.toReversed()) dispose()
    }
  })
}
