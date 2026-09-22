import z from '@deepseek-ai/schemastery'
import { DEFAULT_MODEL, mountJev } from './runtime.js'

export const name = 'jev'
export const inject = ['openrouter', 'settings', 'connection', 'webServer']
export const Config = z.object({ model: z.string().default(DEFAULT_MODEL) })
export function apply(ctx, config = {}) { mountJev(ctx, Config, config) }
