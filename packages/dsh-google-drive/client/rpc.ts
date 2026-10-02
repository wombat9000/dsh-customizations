import type { Api, SessionStatus, AccessStatus, Listing } from './contracts.js'
import { isRecord, errorName } from './contracts.js'

export const api: Api = async (method, body, signal) => {
  let response: Response
  let result: unknown
  try {
    response = await window.fetch(`/api/plugins/google-drive/${method}`, {
      method: 'POST',
      credentials: 'same-origin',
      ...(signal ? { signal } : {}),
      headers: { 'Content-Type': 'application/json', 'X-DSH-Google-Drive': '1' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    if (errorName(error) === 'AbortError') throw error
    throw new Error('Cannot reach DSH. Check your connection and retry.')
  }
  try {
    result = await response.json()
  } catch {
    throw new Error('DSH returned an unreadable Drive response. Retry.')
  }
  if (!response.ok || !isRecord(result) || result.ok !== true)
    throw new Error(
      'Drive access could not be updated. Refresh and check your Google connection, then retry.',
    )
  return result.value
}

export function validSessionStatus(value: unknown): value is SessionStatus {
  if (!isRecord(value)) return false
  if (value.available === false)
    return value.enabled === false && value.ownerId === undefined && value.revision === undefined
  return (
    value.available === true &&
    typeof value.enabled === 'boolean' &&
    typeof value.ownerId === 'string' &&
    value.ownerId.length > 0 &&
    typeof value.revision === 'number' &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0
  )
}

export function validStatus(value: unknown): value is AccessStatus {
  return (
    isRecord(value) &&
    typeof value.state === 'string' &&
    ['pending', 'granted', 'denied', 'cancelled', 'none'].includes(value.state) &&
    Array.isArray(value.grants) &&
    value.grants.every(
      (item: unknown) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.recursive === 'boolean' &&
        (item.name === undefined || typeof item.name === 'string') &&
        (item.mimeType === undefined || typeof item.mimeType === 'string'),
    ) &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    (value.mode === undefined || value.mode === 'read' || value.mode === 'edit') &&
    (value.requestId === undefined || typeof value.requestId === 'string') &&
    (value.state !== 'pending' || typeof value.requestId === 'string')
  )
}

export function validListing(value: unknown): value is Listing {
  return (
    isRecord(value) &&
    Array.isArray(value.files) &&
    value.files.every(
      (item: unknown) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.mimeType === 'string',
    ) &&
    (value.nextPageToken === undefined || typeof value.nextPageToken === 'string')
  )
}
