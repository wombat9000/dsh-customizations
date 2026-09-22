import z from '@deepseek-ai/schemastery'
import { mountOpenRouter } from './runtime.js'

export const name = 'openrouter'
export const inject = ['credentials', 'settings', 'connection', 'webServer']
export const Config = z.object({})

export function apply(ctx) {
  mountOpenRouter(ctx, Config)
}
