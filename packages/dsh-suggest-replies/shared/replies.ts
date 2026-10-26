export const TOOL = 'suggest_replies'

// Validate tool inputs and replayed results at their respective trust boundaries.
export function parseReplies(value: unknown): string[] {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== 'replies') ||
    !('replies' in value) ||
    !Array.isArray(value.replies) ||
    value.replies.length > 3 ||
    value.replies.some(
      (reply: unknown) =>
        typeof reply !== 'string' ||
        !reply.trim() ||
        reply.length > 120 ||
        /[\r\n\u0000-\u001f\u007f]/u.test(reply),
    )
  ) {
    throw new Error(
      'Provide replies as an array of zero to three single-line strings, each 1–120 characters.',
    )
  }
  return [...new Set((value.replies as string[]).map((reply) => reply.trim()))]
}
