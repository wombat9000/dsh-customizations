export class RecapError extends Error {
  readonly code: string
  reason?: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

// Diagnostics contain only fixed reasons and numeric metadata, never model text.
export function invalidRecap(
  reason: string,
  index: number | null = null,
  count: number | null = null,
) {
  const error = new RecapError(
    'invalid-response',
    `Invalid recap: reason=${reason}; index=${index ?? 'none'}; count=${count ?? 'unknown'}.`,
  )
  error.reason = reason
  return error
}
