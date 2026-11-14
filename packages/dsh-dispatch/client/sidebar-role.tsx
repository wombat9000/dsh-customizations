import React from 'react'

// Narrow rc.3 ui-session UseSessions / SessionListState contract. Read the
// existing list projection only: binding a sidebar row would wake that session.
export interface SidebarRoleProps {
  sessionId: string
  useSessions: <T>(
    selector: (state: {
      readonly byId: Readonly<
        Record<
          string,
          { readonly projectionValues?: { readonly agentPreset?: unknown } } | undefined
        >
      >
    }) => T,
  ) => T
}

const coordinator = { mark: 'D', label: 'Dispatch coordinator', preset: 'dispatch' }
const worker = { mark: 'W', label: 'Dispatch Worker', preset: 'dispatch-worker' }

function useRole({ sessionId, useSessions }: SidebarRoleProps) {
  const preset = useSessions((state) => state.byId[sessionId]?.projectionValues?.agentPreset)
  // List metadata can be cached or absent. These are display hints, not claims
  // about assignment ownership, activity, or permission to act on a session.
  return preset === 'dispatch' ? coordinator : preset === 'dispatch-worker' ? worker : null
}

export function SidebarRoleIcon(props: SidebarRoleProps) {
  const role = useRole(props)
  return role ? (
    <span
      role="img"
      aria-label={role.label}
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        boxSizing: 'border-box',
        width: 16,
        height: 16,
        border: '1px solid currentColor',
        borderRadius: 3,
        fontSize: 10,
        lineHeight: 1,
        fontWeight: 600,
      }}
    >
      {role.mark}
    </span>
  ) : null
}

export function SidebarRoleHover(props: SidebarRoleProps) {
  const role = useRole(props)
  return role ? (
    <div>
      <div>{role.label}</div>
      <div>
        Preset: <code>{role.preset}</code>
      </div>
    </div>
  ) : null
}
