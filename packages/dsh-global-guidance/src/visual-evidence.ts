import { readFileSync } from 'node:fs'

export const name = 'global-guidance-visual-evidence'
export const inject = ['systemPrompt']

// Narrow adapter for the published DSH 0.2.0-rc.2 SystemPrompt.section contract.
// The package needs no runtime dependency beyond Node; integration tests mount
// the real registry and Loader. Registration belongs to the calling host row,
// so native component disable/disposal removes it from every scoped assembly.
interface GuidanceContext {
  systemPrompt: {
    section(section: {
      name: string
      order: number
      text: string
      interpolate: boolean
    }): () => void
  }
}

export function apply(ctx: GuidanceContext) {
  ctx.systemPrompt.section({
    name: 'global-guidance:visual-evidence',
    order: 9050,
    interpolate: false,
    text: readFileSync(new URL('../../assets/visual-evidence.md', import.meta.url), 'utf8'),
  })
}
