// Compile-only regressions: unused @ts-expect-error directives fail typechecking.
import type { ComponentProps } from 'react'
import type { CardRequest, CardProps, NativeApprovalDetailProps } from '../../shared/contracts.ts'
import type { GitHubRegistrationContext } from '../../client/registration.ts'
import { validStatus } from '../../client/grant-model.ts'
import { validFieldStatus } from '../../client/field-model.ts'
import { ApprovalText } from '../../client/approval-components.tsx'

export async function transportContracts(request: CardRequest) {
  const value = await request('status', { sessionId: 'session', callId: 'call' })
  // @ts-expect-error Untrusted transport results cannot be consumed before validation.
  value.phase
  if (validStatus(value, 'call')) {
    const phase: string = value.phase
    const login: string | undefined = value.scope?.account.login
    void phase
    void login
  }
  if (validFieldStatus(value, 'call')) {
    const phase: string = value.phase
    void phase
  }
  await request('revoke', { sessionId: 'session', callId: 'call', grantId: 'grant' })
  // @ts-expect-error Every status read is bound to a specific call.
  await request('status', { sessionId: 'session' })
  // @ts-expect-error Revocation requires the exact grant identity.
  await request('revoke', { sessionId: 'session', callId: 'call' })
  // @ts-expect-error Status does not accept a mutation or grant payload.
  await request('status', { sessionId: 'session', callId: 'call', grantId: 'grant' })
  // @ts-expect-error Card transport cannot dispatch GitHub mutations.
  await request('setProjectItemField', { sessionId: 'session', callId: 'call' })
  // @ts-expect-error Session identity is never numeric.
  await request('status', { sessionId: 42, callId: 'call' })
}

export function presentationContracts(ctx: GitHubRegistrationContext) {
  const card: CardProps = { sessionId: 'session', callId: 'call' }
  // @ts-expect-error Call identity cannot collapse to any.
  const badCard: CardProps = { sessionId: 'session', callId: 42 }
  // @ts-expect-error Native detail requires the owning session, not just the call.
  const missingSession: NativeApprovalDetailProps = { callId: 'call' }
  // @ts-expect-error Inspect actions must be callable.
  const badInspect: CardProps = { sessionId: 'session', callId: 'call', inspect: 'inspect' }
  // @ts-expect-error Text rendering cannot receive unvalidated objects.
  const badText: ComponentProps<typeof ApprovalText> = { label: 'Before', value: { text: 'value' } }
  // @ts-expect-error Only the consumed RC2 seats are available.
  ctx.slots.inject('conversation.unknown', () => {})
  ctx.slots.register<'conversation.approval.detail'>(
    // @ts-expect-error Native approval is a single seat, not a keyed tool seat.
    { name: 'conversation.approval.detail', key: 'github' },
    () => null,
  )
  ctx.slots.register<'tool.call.toolview'>(
    // @ts-expect-error Tool seat registration requires a key.
    { name: 'tool.call.toolview', priority: -10 },
    () => null,
  )
  void card
  void badCard
  void missingSession
  void badInspect
  void badText
}
