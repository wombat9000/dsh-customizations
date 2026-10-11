import type { ComponentType } from 'react'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionClientContext } from './session-contracts.ts'

export const DIRECTORY_ALIAS = 'conversation.hero.worktree.directoryFlow'
const SOURCE = 'conversation.hero.workspace.directoryFlow'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.hero.worktree.directoryFlow': {
      kind: 'single'
      scope: 'root'
      owner: DirectoryFlowOwnerProps
    }
  }
}
interface AliasRegistrar {
  register(
    options: {
      name: typeof DIRECTORY_ALIAS
      locale?: string
      inject?: () => Record<string, unknown>
    },
    component: ComponentType<DirectoryFlowOwnerProps>,
  ): () => void
}

/** RC2 child declarations belong to ONE entry. Use a plugin-owned hole and
 * re-register the native flow's public component/inject/locale into it, with
 * the same root scope and owner contract. Never mutate native StoredEntry data
 * or redeclare its child. Preserve provider disposal/replacement via the ledger.
 */
export function mountDirectoryAlias(ctx: SessionClientContext) {
  ctx.slots.inject(DIRECTORY_ALIAS, () => {
    let previous: unknown
    let unregister: (() => void) | undefined
    const reconcile = () => {
      const entry = [...ctx.slots.entries(SOURCE)].sort(
        (a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0),
      )[0]
      if (entry === previous) return
      unregister?.()
      unregister = undefined
      previous = entry
      // The pinned native directory flows have no stores/children/selectors.
      // Refuse unfamiliar lifecycle shares rather than copying them incorrectly.
      if (
        !entry ||
        entry.store ||
        entry.children ||
        entry.select ||
        typeof entry.component !== 'function'
      )
        return
      const registrar = ctx.slots as unknown as AliasRegistrar
      unregister = registrar.register(
        {
          name: DIRECTORY_ALIAS,
          ...(entry.locale ? { locale: entry.locale } : {}),
          ...(entry.inject ? { inject: entry.inject as () => Record<string, unknown> } : {}),
        },
        entry.component as ComponentType<DirectoryFlowOwnerProps>,
      )
    }
    const unsubscribe = ctx.slots.subscribe(SOURCE, reconcile)
    reconcile()
    return () => {
      unsubscribe()
      unregister?.()
    }
  })
}
