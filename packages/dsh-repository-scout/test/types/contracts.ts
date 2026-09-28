import type {
  Answer,
  BoolQuestion,
  ChoiceQuestion,
  ScoreQuestion,
  ScoutRequest,
  ScoutResult,
} from '../../src/contracts.js'

const question: BoolQuestion = {
  id: 'auth',
  question: 'Does this file implement a permission check?',
  criteria: { true: 'Direct implementation', false: 'No implementation' },
}
const choice: ChoiceQuestion = {
  id: 'layer',
  question: 'Primary responsibility?',
  choices: [{ id: 'other', description: 'Other responsibility' }],
}
const score: ScoreQuestion = {
  id: 'fit',
  question: 'How directly relevant?',
  levels: ['Unrelated', 'Direct implementation'],
}
void [question, choice, score]
const incomplete: BoolQuestion = {
  id: 'auth',
  question: 'Permission check?',
  // @ts-expect-error Explicit criteria need both boundaries.
  criteria: { true: 'Direct check' },
}
// @ts-expect-error Ordered levels must be descriptions, not numeric ratings.
const numericLevels: ScoreQuestion = { id: 'fit', question: 'Relevant?', levels: [0, 1] }
const inventedConfidence: Answer = {
  id: 'auth',
  type: 'boolean',
  probability: 0.8,
  // @ts-expect-error A Boolean probability does not have a confidence field.
  confidence: 0.9,
}
const budget: ScoutRequest = {
  kind: 'files',
  pattern: '**/*.ts',
  question: 'Relevant?',
  // @ts-expect-error Batch file budgets are numbers, not strings.
  maxFiles: '12',
}
// @ts-expect-error Exact optional properties reject explicit undefined.
const undefinedCriteria: BoolQuestion = { id: 'q', question: 'Relevant?', criteria: undefined }
void [incomplete, numericLevels, inventedConfidence, budget, undefinedCriteria]

export function inspect(result: ScoutResult): void {
  const file = result.files[0]
  // @ts-expect-error noUncheckedIndexedAccess requires checking empty discovery.
  file.status
  if (file?.status === 'evaluated') {
    const answer = file.answers[0]
    if (answer?.type === 'score') answer.levels[0]?.toUpperCase()
    // @ts-expect-error Scouting returns judgments, never source bodies.
    file.content
  }
}
