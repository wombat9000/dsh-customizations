import React from 'react'
import type { CardProps } from '../shared/contracts.ts'
import { GrantPresentation } from './grant-components.tsx'
import { useGitHubCallPresentation } from './use-github-call-presentation.ts'
export function GrantCard(props: CardProps) {
  const { block, inspect } = props
  const { status, pending, error, busy, refresh, revoke } = useGitHubCallPresentation(
    'grant',
    props,
  )
  let phase = pending ? 'awaiting-approval' : status?.phase
  if (
    !pending &&
    phase !== undefined &&
    ['active', 'granted', 'confirmed'].includes(phase) &&
    !status?.grants.some((grant) => grant.state === 'active')
  ) {
    const states = new Set(status?.grants.map((grant) => grant.state))
    phase = states.size === 1 ? [...states][0] : undefined
  }
  return (
    <GrantPresentation
      status={status}
      pending={pending}
      phase={phase}
      error={error}
      busy={busy}
      block={block}
      inspect={inspect}
      refresh={refresh}
      revoke={revoke}
    />
  )
}
