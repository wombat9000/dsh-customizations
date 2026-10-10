import React from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionClientContext } from './session-contracts.ts'
import { shellSeats } from './session-contracts.ts'
import { createSessionStore } from './session-store.ts'
import {
  BranchIcon,
  CopyCheckout,
  SessionHover,
  SessionLeading,
  SessionOverlay,
  SessionWorktreesPage,
} from './session-components.tsx'
import { mountHeroPicker } from './session-slot.tsx'

export function mountSessionClient(ctx: SessionClientContext) {
  const store = createSessionStore(ctx)
  ctx.effect(() => store.start())
  mountHeroPicker(ctx, store)
  ctx.slots.inject('sidebar.session.row.leading', () =>
    ctx.slots.register(
      { name: 'sidebar.session.row.leading', id: 'local-worktree-session', order: 30 },
      (props: PropsRuntime<'sidebar.session.row.leading'>) => (
        <SessionLeading {...props} store={store} />
      ),
    ),
  )
  ctx.slots.inject('sidebar.session.row.hover', () =>
    ctx.slots.register(
      { name: 'sidebar.session.row.hover', id: 'local-worktree-session', order: 30 },
      (props: PropsRuntime<'sidebar.session.row.hover'>) => (
        <SessionHover {...props} store={store} />
      ),
    ),
  )
  ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
    ctx.slots.register(
      {
        name: 'sidebar.workspaces.session.menu.item',
        id: 'local-worktree-copy-checkout',
        order: 350,
      },
      (props: PropsRuntime<'sidebar.workspaces.session.menu.item'>) => (
        <CopyCheckout {...props} store={store} />
      ),
    ),
  )
  ctx.slots.inject('sidebar.panellist', () =>
    shellSeats(ctx).register(
      {
        name: 'sidebar.panellist',
        id: 'local-session-worktrees',
        order: 15,
        label: 'Session worktrees',
      },
      BranchIcon,
    ),
  )
  ctx.slots.inject('main', () =>
    shellSeats(ctx).register({ name: 'main', key: 'local-session-worktrees' }, () => (
      <SessionWorktreesPage store={store} />
    )),
  )
  ctx.slots.inject('shell.overlay', () =>
    shellSeats(ctx).register(
      { name: 'shell.overlay', id: 'local-session-worktrees', order: 30 },
      () => <SessionOverlay store={store} />,
    ),
  )
}
