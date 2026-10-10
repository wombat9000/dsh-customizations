import React from 'react'
import type { SessionClientContext } from './session-contracts.ts'
import type { SessionStore } from './session-store.ts'
import { SessionPicker } from './session-picker.tsx'
import { DIRECTORY_ALIAS, mountDirectoryAlias } from './directory-alias.ts'

export function mountHeroPicker(ctx: SessionClientContext, store: SessionStore) {
  // Standard RC2 picker priority is 0; lower wins. Use our own child declaration
  // because the native entry continues to own its original directory-flow hole.
  // Disposing this registration restores native election without changing any
  // native entry/component or private controller.
  const directoryFlow = {
    getSnapshot: () => ctx.slots.entries(DIRECTORY_ALIAS).length > 0,
    subscribe: (listener: () => void) => ctx.slots.subscribe(DIRECTORY_ALIAS, listener),
  }
  ctx.slots.inject('conversation.hero.workspace', () =>
    ctx.slots.register(
      {
        name: 'conversation.hero.workspace',
        priority: -10,
        children: { [DIRECTORY_ALIAS]: { kind: 'single', scope: 'root' } },
        locale: 'workspace',
        inject: () => ({
          createWorkspace: (input: { path: string }) => ctx.workspaces.create(input),
          hooks: { directoryFlow },
        }),
      },
      (props) => <SessionPicker {...props} ctx={ctx} store={store} />,
    ),
  )
  mountDirectoryAlias(ctx)
}
