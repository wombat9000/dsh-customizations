export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export interface BoolQuestion {
  id: string
  question: string
  criteria?: { true: string; false: string }
}
export interface ChoiceQuestion {
  id: string
  question: string
  choices: { id: string; description: string }[]
}
export interface ScoreQuestion {
  id: string
  question: string
  levels: string[]
}
export type ScoutRequest =
  | { kind: 'boolean'; path: string; questions: BoolQuestion[] }
  | { kind: 'choice'; path: string; questions: ChoiceQuestion[] }
  | { kind: 'score'; path: string; questions: ScoreQuestion[] }
  | {
      kind: 'files'
      pattern: string
      question: string
      criteria?: BoolQuestion['criteria']
      maxFiles: number
    }

export interface FileSnapshot {
  path: string
  content: string
  sha256: string
  bytes: number
}
export type SkipReason =
  | 'excluded'
  | 'outside_workspace'
  | 'symlink'
  | 'not_text'
  | 'too_large'
  | 'sensitive_content'
  | 'unreadable'
  | 'changed'
  | 'byte_limit'
  | 'file_limit'
export interface Discovery {
  files: FileSnapshot[]
  matchedFiles: number
  visitedEntries: number
  complete: boolean
  skipped: { reason: SkipReason; count: number }[]
}
export type JevQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }
export interface JevService {
  settings(): { model: unknown }
  evaluate(input: {
    state: Json
    questions: Record<string, JevQuestion>
    signal: AbortSignal
  }): Promise<unknown>
}
export interface PreparedScan {
  request: ScoutRequest
  model: string
  discovery: Discovery
  questions: Record<string, JevQuestion>
}
export type Answer =
  | { id: string; type: 'boolean'; probability: number }
  | {
      id: string
      type: 'choice'
      choice: string
      confidence: number
      probabilities: { option: string; probability: number }[]
    }
  | {
      id: string
      type: 'score'
      score: number
      confidence: number
      levels: string[]
      probabilities: { level: number; probability: number }[]
    }
export type FileResult = {
  path: string
  sha256: string
  bytes: number
} & ({ status: 'evaluated'; answers: Answer[] } | { status: 'failed'; reason: string })
export type ScoutResult = {
  kind: ScoutRequest['kind']
  model: string
  files: FileResult[]
  coverage: {
    matchedFiles: number
    visitedEntries: number
    discoveryComplete: boolean
    evaluatedFiles: number
    failedFiles: number
    skipped: { reason: SkipReason; count: number }[]
  }
  usage: {
    providerCalls: number
    reportedCalls: number
    complete: boolean
    inputTokens?: number
    outputTokens?: number
    cost?: number
  }
  notices: string[]
}

export const LIMITS = Object.freeze({
  questions: 8,
  questionChars: 1024,
  criterionChars: 512,
  choiceOptions: 16,
  scoreLevels: 10,
  fileBytes: 16_384,
  batchBytes: 131_072,
  requestBytes: 60_000,
  defaultFiles: 12,
  maxFiles: 24,
  visitedEntries: 2_000,
  directories: 128,
  candidates: 256,
  depth: 12,
  concurrentRequests: 2,
  timeoutMs: 120_000,
})
