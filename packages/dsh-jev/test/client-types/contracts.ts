import { call, type Rpc } from '../../client/rpc.ts'
import type { SettingsProps } from '../../client/settings.tsx'

declare const rpc: Rpc
void call(rpc, 'status', {})
void call(rpc, 'configure', { model: 'typesafe/jev-1.13' })
// @ts-expect-error Browser RPC must never expose paid host evaluations.
void call(rpc, 'evaluate', {})
// @ts-expect-error Model configuration requires its model field.
void call(rpc, 'configure', {})
// @ts-expect-error Status requests have no model configuration field.
void call(rpc, 'status', { model: 'typesafe/jev-1.13' })
const props: SettingsProps = { rpc, view: 'summary' }
// @ts-expect-error Native settings seats have a fixed set of views.
const invalidProps: SettingsProps = { rpc, view: 'conversation' }
void [props, invalidProps]
