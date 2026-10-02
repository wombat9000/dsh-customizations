import z from '@deepseek-ai/schemastery'
import { DEFAULT_MODEL, mountJev, type JevContext } from './runtime.js'
export type {
  JevRequest,
  JevQuestion,
  JevAnswer,
  JevResult,
  JevService,
  JevStatus,
} from '../shared/contracts.js'

export const name = 'jev'
export const inject = ['openrouter', 'connection', 'webServer']
export const Config = z.object({ model: z.string().default(DEFAULT_MODEL).volatile() })
export function apply(ctx: JevContext, config: ReturnType<typeof Config>) {
  mountJev(ctx, config)
}
