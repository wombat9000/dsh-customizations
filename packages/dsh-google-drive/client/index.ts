import type { ComponentType } from 'react'
import { api, validSessionStatus, validStatus } from './rpc.js'
import { SessionToggle } from './toggle.js'
import { Card, EditCard, Picker, Overlay } from './access.js'
import { PreviewCard, PreviewDialog, validPreviewStatus, cellStyle } from './preview.js'
import { createPickerStore } from './store.js'

interface Seat<P> {
  name: string
  id?: string
  key?: string
  order?: number
  inject?: (...args: string[]) => Partial<P>
}
interface ClientContext {
  slots: {
    inject(name: string, callback: () => unknown): unknown
    register<P>(seat: Seat<P>, component: ComponentType<P>): unknown
  }
  effect(effect: () => () => void): unknown
}

export default {
  inject: ['slots'],
  api,
  SessionToggle,
  validSessionStatus,
  validStatus,
  validPreviewStatus,
  cellStyle,
  createPickerStore,
  Card,
  EditCard,
  PreviewCard,
  PreviewDialog,
  Picker,
  Overlay,
  apply(ctx: ClientContext) {
    ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register(
        {
          name: 'conversation.session.header.utilities',
          id: 'google-drive-session-toggle',
          order: 20,
          inject: (sessionId) => ({ sessionId: sessionId!, api }),
        },
        SessionToggle,
      ),
    )
    const picker = createPickerStore()
    ctx.effect(() => () => picker.close())
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register(
        { name: 'tool.call.toolview', key: 'request_drive_access', inject: () => ({ picker }) },
        Card,
      ),
    )
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'google-drive-access', inject: () => ({ picker }) },
        Overlay,
      ),
    )
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register(
        {
          name: 'tool.call.toolview',
          key: 'request_sheets_edit_access',
          inject: () => ({ picker }),
        },
        EditCard,
      ),
    )
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register(
        { name: 'tool.call.toolview', key: 'google_sheets_propose_edit' },
        PreviewCard,
      ),
    )
  },
}
