import type { CardRequest } from '../shared/contracts.ts'
import { object } from './validation.ts'
// Stable module-level function identity is part of both polling effects' contract.
export const api: CardRequest = async (action, body, signal) => {
  if (!['status', 'revoke'].includes(action)) throw new Error('Unsupported GitHub card action.')
  const response = await fetch(`/api/plugins/github/${action}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-dsh-github': '1' },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok)
    throw new Error('GitHub access status is unavailable. No new access was requested.')
  const result: unknown = await response.json()
  if (!object(result) || result.ok !== true)
    throw new Error('GitHub access status is unavailable. No new access was requested.')
  return result.value
}
