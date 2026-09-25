import type { ToolBlock } from '../shared/contracts.ts'
import { object, text, id } from './validation.ts'

export const FIELD_TOOL = 'github_set_project_item_field'
const fieldKeys = {
  TEXT: 'text',
  NUMBER: 'number',
  DATE: 'date',
  SINGLE_SELECT: 'singleSelectOptionId',
  ITERATION: 'iterationId',
}
function fieldType(value: unknown): value is keyof typeof fieldKeys {
  return typeof value === 'string' && Object.hasOwn(fieldKeys, value)
}

export interface FieldValueModel {
  available: boolean
  label: string
  identity?: string
  detail?: string
}

export function fieldValueModel(change: unknown, side: string): FieldValueModel {
  const missing = {
    available: false,
    label: side === 'before' ? 'Previous value unavailable' : 'Proposed value unavailable',
  }
  if (
    !object(change) ||
    !object(change.field) ||
    !id(change.field.id) ||
    !fieldType(change.field.dataType)
  )
    return missing
  const value = change[side],
    type = change.field.dataType
  if (side === 'before' && value === null) return { available: true, label: 'Not set' }
  if (!object(value)) return missing
  if (side === 'before' && value.field) {
    if (
      !object(value.field) ||
      value.field.id !== change.field.id ||
      (value.field.dataType && value.field.dataType !== type)
    )
      return missing
  }
  const key = side === 'before' && type === 'SINGLE_SELECT' ? 'optionId' : fieldKeys[type]
  if (side === 'after' && (Object.keys(value).length !== 1 || !Object.hasOwn(value, key)))
    return missing
  const leaf = value[key]
  if (type === 'TEXT')
    return typeof leaf === 'string' ? { available: true, label: JSON.stringify(leaf) } : missing
  if (type === 'NUMBER')
    return typeof leaf === 'number' && Number.isFinite(leaf)
      ? { available: true, label: String(leaf) }
      : missing
  if (type === 'DATE')
    return typeof leaf === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(leaf) &&
      !Number.isNaN(Date.parse(leaf)) &&
      new Date(leaf).toISOString().slice(0, 10) === leaf
      ? { available: true, label: leaf }
      : missing
  if (!id(leaf)) return missing
  const selected =
    side === 'before'
      ? value
      : object(change.selectedOption) && change.selectedOption.id === leaf
        ? change.selectedOption
        : null
  const friendly = text(type === 'SINGLE_SELECT' ? selected?.name : selected?.title)
  return {
    available: true,
    label: friendly || leaf,
    identity: leaf,
    ...(type === 'ITERATION' && selected
      ? {
          detail: [
            text(selected.startDate),
            Number.isFinite(selected.duration) ? `${selected.duration} days` : '',
          ]
            .filter(Boolean)
            .join(' · '),
        }
      : {}),
  }
}

export interface FieldStatus {
  version: 1
  phase: string
  toolName?: string
  callId?: string
  exactPreview?: string
  change?: Record<string, unknown>
  targets?: Record<string, unknown>
  result?: unknown
}
export function validFieldStatus(value: unknown, callId: string): value is FieldStatus {
  if (!object(value) || value.version !== 1 || !id(value.phase)) return false
  if (value.toolName === undefined && value.callId === undefined)
    return value.phase === 'expired' && value.change === undefined && value.targets === undefined
  return (
    value.toolName === FIELD_TOOL &&
    value.callId === callId &&
    (value.exactPreview === undefined || typeof value.exactPreview === 'string') &&
    (value.change === undefined || object(value.change)) &&
    (value.targets === undefined || object(value.targets))
  )
}
export type FieldResult = Record<string, unknown> & {
  outcome: 'no-change' | 'failed' | 'confirmed' | 'uncertain'
}
function isFieldResult(value: unknown): value is FieldResult {
  if (
    !object(value) ||
    value.host !== 'github.com' ||
    !(
      value.operation === 'setProjectItemField' ||
      (value.operation === undefined && value.outcome === 'failed' && object(value.error))
    )
  )
    return false
  const outcome = value.outcome
  if (outcome === 'no-change')
    return value.dispatched === false && value.reason === 'FIELD_VALUE_ALREADY_SET'
  return outcome === 'failed' || outcome === 'confirmed' || outcome === 'uncertain'
}
export function validatedFieldResult(value: unknown): FieldResult | undefined {
  return isFieldResult(value) ? value : undefined
}
export function fieldSafeText(value: unknown): string {
  return text(value)
    .slice(0, 4096)
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[REDACTED]')
    .replace(/\bBearer\s+[^\s"'<>]+/gi, '[REDACTED]')
    .replace(/\bAuthorization\s*:\s*token\s+[^\s"'<>]+/gi, '[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:access_token|token|auth|key)=)[^&#\s]+/gi, '$1[REDACTED]')
}
export function fieldFailureReason(
  block: ToolBlock | undefined,
  result: FieldResult | undefined,
): string {
  if (result?.outcome === 'failed')
    return fieldSafeText(
      (object(result.error) ? result.error.message : undefined) || result.message,
    )
  if (block?.isError === true && !result && Array.isArray(block.content))
    return fieldSafeText(
      block.content
        .filter((part) => part?.type === 'text')
        .map((part) => text(part.text))
        .join('\n'),
    )
  return ''
}
export function fieldRequestedTarget(block: ToolBlock | undefined): string {
  try {
    const args: unknown = JSON.parse(block?.call?.argsRaw ?? block?.argsRaw ?? '')
    if (!object(args)) return ''
    return [
      typeof args.owner === 'string' && `Owner: ${fieldSafeText(args.owner)}`,
      typeof args.projectNumber === 'number' &&
        Number.isSafeInteger(args.projectNumber) &&
        args.projectNumber > 0 &&
        `Project number: ${args.projectNumber}`,
      id(args.itemId) && `Item ID: ${fieldSafeText(args.itemId)}`,
      id(args.fieldId) && `Field ID: ${fieldSafeText(args.fieldId)}`,
    ]
      .filter(Boolean)
      .join('; ')
  } catch {
    return ''
  }
}
export function fieldResult(block: ToolBlock | undefined): FieldResult | undefined {
  if (block?.kind !== 'tool-result' || !Array.isArray(block.content)) return undefined
  const parts = block.content.filter(
    (part) => part?.type === 'text' && typeof part.text === 'string',
  )
  const part = parts[0]
  if (parts.length !== 1 || typeof part?.text !== 'string' || part.text.length > 262144)
    return undefined
  try {
    return validatedFieldResult(JSON.parse(part.text))
  } catch {
    return undefined
  }
}
export function fieldPhase(
  status: FieldStatus | null | undefined,
  block: ToolBlock | undefined,
  pending: unknown,
): string {
  const result = fieldResult(block),
    recorded = validatedFieldResult(status?.result)
  if (
    result?.outcome === 'uncertain' ||
    recorded?.outcome === 'uncertain' ||
    status?.phase === 'uncertain' ||
    (block?.isError === true && (result?.outcome === 'confirmed' || status?.phase === 'confirmed'))
  )
    return 'uncertain'
  if (block?.isError === true) return 'failed'
  if (result?.outcome) return result.outcome
  if (recorded?.outcome === 'no-change' && block?.kind !== 'tool-result') return 'no-change'
  if (status?.phase === 'no-change') return 'unknown'
  if (pending) return 'awaiting-approval'
  if (block?.kind === 'tool-result')
    return recorded?.outcome === 'confirmed'
      ? 'confirmed'
      : status && ['denied', 'failed', 'unattempted'].includes(status.phase)
        ? status.phase
        : 'unknown'
  return status?.phase ?? 'unknown'
}
const phaseLabels: Record<string, string> = {
  prepared: 'Proposed change prepared',
  preparing: 'Preparing change',
  approved: 'Approved — write not yet confirmed',
  'authorized-by-grant': 'Authorized by session grant — write not yet confirmed',
  running: 'Running — write not yet confirmed',
  'awaiting-approval': 'Awaiting approval',
  denied: 'Denied — not executed',
  unattempted: 'Not executed',
  failed: 'Field change failed',
  'no-change': 'No change needed',
  confirmed: 'GitHub confirmed the update',
  uncertain: 'Outcome uncertain — the write may have succeeded',
  expired: 'Prepared details expired — outcome unknown',
}
export function fieldPhaseLabel(phase: string): string {
  return phaseLabels[phase] ?? 'Outcome unknown — no success is inferred'
}
