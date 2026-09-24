// Compile-only regressions. An unused @ts-expect-error fails the typecheck too.
import type { ComponentProps } from 'react'
import type { Recap, Rpc, RpcResult, Settings } from '../../shared/contracts.ts'
import type { Controller } from '../../client/controller-types.ts'
import type { RecapRegistrationContext } from '../../client/registration.ts'
import type { RecapActionProps } from '../../client/containers/recap.tsx'
import type { SettingsFormProps } from '../../client/components/SettingsForm.tsx'
import { RecapTile, RecapPanel } from '../../client/components/RecapPanel.tsx'
import { RecapActionButton } from '../../client/components/RecapActionButton.tsx'

export async function rpcContracts(rpc: Rpc) {
  const response = await rpc.call('/session-recap', 'settings', {})
  if (response.ok) {
    const settings: Settings = response.value
    const scope: string = response.value.storageScope
    void settings; void scope
    // @ts-expect-error Successful responses have a value, not an error.
    response.error
  } else {
    const message: string = response.error.message
    void message
    // @ts-expect-error Failed responses have no value.
    response.value
  }
  await rpc.call('/session-recap', 'configure', { useJev: true, inactivityMinutes: 45 })
  await rpc.call('/session-recap', 'recap', { sessionId: 's', automatic: false })
  // @ts-expect-error Inactivity is numeric on the wire, even if the input draft is text.
  await rpc.call('/session-recap', 'configure', { inactivityMinutes: '45' })
  // @ts-expect-error A recap requires a session ID.
  await rpc.call('/session-recap', 'recap', {})
  // @ts-expect-error Settings reads do not accept session payloads.
  await rpc.call('/session-recap', 'settings', { sessionId: 's' })
  // @ts-expect-error Unknown endpoints are not callable.
  await rpc.call('/session-recap', 'delete-session', {})
  // @ts-expect-error This client cannot target another RPC channel.
  await rpc.call('/other-plugin', 'settings', {})
}

export function dataContracts(controller: Controller, onChange: SettingsFormProps['onChange']) {
  const bullets: Recap = { bullets: ['A remembered direction.'] }
  const cards: Recap = { headline: 'Current direction', cards: [{ label: 'direction', text: 'Explore options.' }] }
  const result: RpcResult<Recap> = { ok: true, value: cards }
  void result
  // @ts-expect-error Cards and bullets are mutually exclusive host response shapes.
  const mixed: Recap = { headline: 'Mixed', bullets: ['A'], cards: [] }
  // @ts-expect-error Visual cards require a headline.
  const missingHeadline: Recap = { cards: [{ label: 'direction', text: 'A' }] }
  // @ts-expect-error Model-generated arrays are readonly.
  bullets.bullets.push('Mutation')
  // @ts-expect-error A card label comes from the fixed vocabulary.
  const unknownCard: ComponentProps<typeof RecapTile> = { card: { label: 'custom', text: 'A' } }
  // @ts-expect-error Error text is a string, not an arbitrary object.
  const invalidPanel: ComponentProps<typeof RecapPanel> = { error: { message: 'No' } }
  // @ts-expect-error Button callbacks must be callable.
  const invalidAction: ComponentProps<typeof RecapActionButton> = { onClick: 'submit' }
  // @ts-expect-error Published assistant message identity must not collapse to any.
  const invalidMessage: RecapActionProps['messageId'] = 42
  // @ts-expect-error Controller flags retain boolean types.
  controller.getSnapshot('s').busy = 'yes'
  onChange('inactivityMinutes', '45')
  onChange('useJev', true)
  // @ts-expect-error A boolean draft field cannot receive a text value.
  onChange('useJev', 'true')
  void mixed; void missingHeadline; void unknownCard; void invalidPanel; void invalidAction; void invalidMessage
}

export function slotContracts(ctx: RecapRegistrationContext, controller: Controller) {
  // @ts-expect-error A slot name cannot silently widen to string/any.
  ctx.slots.inject('conversation.unknown', () => {})
  ctx.slots.register<'conversation.input.dock'>({
    name: 'conversation.input.dock', id: 'fixture', order: 10,
    // @ts-expect-error Session injection must include a string identity.
    inject: () => ({ sessionId: 42, controller }),
  }, () => null)
}
