import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { BUNDLED_SKILL_RANK, type SkillProvider, type SkillCandidate } from '@deepseek-ai/dsh-skill'

const body = new URL('../../assets/file-intuition.md', import.meta.url)
const candidate = {
  name: 'file-intuition',
  description:
    'Reference for fast, System 1-style file judgments with Jev: ask_file, classify_file, score_file and scout_files. Covers tool selection, parameters, examples, question design, probability and score semantics, coverage, failures and disclosure limits.',
  whenToUse:
    'Read when using ask_file, classify_file, score_file, or scout_files for guidance on question design and interpreting their results.',
  invocation: { modelInvocable: true, userInvocable: true },
  provider: 'file-intuition-bundled',
  source: 'bundled',
  resourceBase: {
    kind: 'directory',
    path: fileURLToPath(new URL('../../assets/', import.meta.url)),
  },
  rank: BUNDLED_SKILL_RANK,
  locator: body,
} as const satisfies SkillCandidate

export function createScoutSkillProvider(): SkillProvider {
  return {
    name: candidate.provider,
    async list() {
      return [candidate]
    },
    async get(selected, options) {
      if (selected.name !== candidate.name) return undefined
      return {
        ...candidate,
        content: await readFile(body, {
          encoding: 'utf8',
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }),
      }
    },
  }
}
