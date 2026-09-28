import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import { createScoutSkillProvider } from './skill.js'
import { registerScoutTools } from './tools.js'

export const name = 'repository-scout'
export const inject = ['tools', 'fs', 'skills']
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => createScoutSkillProvider())
  registerScoutTools(ctx)
}
export { createScoutSkillProvider, registerScoutTools }
