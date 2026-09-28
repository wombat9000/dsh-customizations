import { isRecord } from './response-values.js'

const SAFE_INTERACTION_STATUSES = new Set([
  'in_progress',
  'requires_action',
  'completed',
  'failed',
  'cancelled',
  'incomplete',
  'budget_exceeded',
  'queued',
])
const SAFE_INTERACTION_ERROR_CODES = new Set([
  'BLOCKLIST',
  'DEADLINE_EXCEEDED',
  'INTERNAL',
  'INVALID_ARGUMENT',
  'MAX_TOKENS',
  'PROHIBITED_CONTENT',
  'RECITATION',
  'RESOURCE_EXHAUSTED',
  'SAFETY',
  'SAFETY_BLOCKED',
  'UNAVAILABLE',
])
const INTERACTION_FILTER_CODES = new Set([
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'RECITATION',
  'SAFETY',
  'SAFETY_BLOCKED',
])

function interactionDiagnosticCodes(interaction: unknown) {
  if (!isRecord(interaction) || !Array.isArray(interaction.errors)) return []
  return [
    ...new Set(
      interaction.errors.flatMap((error) => {
        const code =
          isRecord(error) && typeof error.code === 'string'
            ? error.code.toLocaleUpperCase('en-US')
            : undefined
        return code !== undefined && SAFE_INTERACTION_ERROR_CODES.has(code) ? [code] : []
      }),
    ),
  ]
}

function interactionDiagnostic(interaction: Record<string, unknown>) {
  const status =
    typeof interaction.status === 'string' && SAFE_INTERACTION_STATUSES.has(interaction.status)
      ? interaction.status
      : 'unknown'
  const codes = interactionDiagnosticCodes(interaction)
  return `status: ${status}${codes.length === 0 ? '' : `; diagnostic codes: ${codes.join(', ')}`}`
}

export function interactionHasContentFilter(interaction: unknown) {
  return interactionDiagnosticCodes(interaction).some((code) => INTERACTION_FILTER_CODES.has(code))
}

export function markInteractionFilter<T extends Error>(error: T, interaction: unknown): T {
  if (
    interactionHasContentFilter(interaction) &&
    (!('reason' in error) || error.reason !== 'content_filter')
  ) {
    Object.defineProperty(error, 'reason', { value: 'content_filter' })
  }
  return error
}

export function interactionText(interaction: unknown, operation: string): unknown {
  if (!isRecord(interaction)) {
    throw new Error(`Gemini returned an invalid ${operation} response`)
  }
  const diagnostic = interactionDiagnostic(interaction)
  const outputError = (message: string) => markInteractionFilter(new Error(message), interaction)
  if (interactionHasContentFilter(interaction)) {
    throw outputError(`Gemini blocked ${operation} through content filters (${diagnostic})`)
  }
  if (interaction.status !== undefined && interaction.status !== 'completed') {
    throw outputError(`Gemini could not complete ${operation} (${diagnostic})`)
  }
  if (typeof interaction.output_text !== 'string' || interaction.output_text.trim().length === 0) {
    throw outputError(`Gemini returned no ${operation} output (${diagnostic})`)
  }
  try {
    return JSON.parse(interaction.output_text)
  } catch {
    throw outputError(`Gemini returned malformed JSON for ${operation}`)
  }
}
