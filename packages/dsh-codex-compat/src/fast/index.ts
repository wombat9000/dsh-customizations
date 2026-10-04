import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { mountCodexFast } from './runtime.js'
export const name = 'local-codex-fast'
export const inject = [
  'llm',
  'agents',
  'sessionProjections',
  'agentDefaultModel',
  'connection',
  'webServer',
  'storageDomain',
  'settings',
]
export const Config = z.object({})
export async function apply(ctx: Context) {
  await mountCodexFast(ctx)
}
