export class RecapError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// Diagnostics contain only fixed reasons and numeric metadata, never model text.
export function invalidRecap(reason, index = null, count = null) {
  const error = new RecapError(
    'invalid-response',
    `Invalid recap: reason=${reason}; index=${index ?? 'none'}; count=${count ?? 'unknown'}.`,
  )
  error.reason = reason
  return error
}
