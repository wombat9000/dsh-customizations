import { z } from 'zod'

export const sessionEnvironmentRequestSchema = z
  .object({
    sessionId: z.string().min(1).readonly(),
  })
  .strict()

export const sessionCIRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    checkoutKey: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export const sessionCISnapshotSchema = z
  .object({
    checkoutKey: z.string().regex(/^[a-f0-9]{64}$/),
    checkedAt: z.number().nonnegative(),
    freshUntil: z.number().nonnegative(),
    refreshAfterMs: z.number().int().min(15000).max(300000),
    error: z.string().max(300).nullable(),
    stale: z.boolean(),
    rows: z
      .array(
        z
          .object({
            kind: z.enum(['current', 'default']),
            label: z.string().max(1100),
            sha: z
              .string()
              .regex(/^[a-f0-9]{40}$/)
              .nullable(),
            url: z
              .string()
              .regex(
                /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+\/(?:pull\/\d+|commit\/[a-f0-9]{40})\/checks$/,
              )
              .nullable(),
            state: z.enum([
              'pending',
              'running',
              'failure',
              'success',
              'cancelled',
              'skipped',
              'neutral',
              'stale',
              'unknown',
              'no-checks',
            ]),
            complete: z.boolean(),
            count: z.number().int().nonnegative().max(400),
            mismatch: z.boolean(),
            warning: z.string().max(300).nullable(),
          })
          .strict(),
      )
      .max(2),
  })
  .strict()

const nullableText = z.union([z.string(), z.literal(null)]).readonly()
const nullableBoolean = z.union([z.boolean(), z.literal(null)]).readonly()
const nullableCount = z.union([z.number().int().nonnegative(), z.literal(null)]).readonly()

export const sessionEnvironmentSnapshotSchema = z
  .object({
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
    checkoutKey: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional()
      .readonly(),
    error: z.string().optional().readonly(),
  })
  .strict()
