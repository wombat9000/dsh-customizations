import { z } from 'zod'

export const sessionEnvironmentRequestSchema = z.object({
  sessionId: z.string().min(1).readonly(),
}).strict()

const nullableText = z.union([z.string(), z.literal(null)]).readonly()
const nullableBoolean = z.union([z.boolean(), z.literal(null)]).readonly()
const nullableCount = z.union([z.number().int().nonnegative(), z.literal(null)]).readonly()

export const sessionEnvironmentSnapshotSchema = z.object({
  cwd: nullableText,
  home: z.string().readonly(),
  repo: nullableBoolean,
  hasHead: nullableBoolean,
  branch: nullableText,
  upstream: nullableText,
  ahead: nullableCount,
  behind: nullableCount,
  dirtyFiles: nullableCount,
  additions: nullableCount,
  deletions: nullableCount,
  error: z.string().optional().readonly(),
}).strict()
