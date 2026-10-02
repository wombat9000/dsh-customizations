import type { JevAnswer, JevRequest, RpcEndpoints, RpcResult } from '../../shared/contracts.js'
import { createJevRuntime } from '../../src/runtime.js'

const runtime = createJevRuntime({
  openrouter: { status: async () => ({}), resolveApiKey: async () => 'fixture' },
  getModel: () => 'typesafe/jev-1.13',
  saveModel: async (_model: string) => {},
})
const request: JevRequest = {
  state: { ready: true },
  questions: {
    ready: { type: 'noul', instructions: 'Ready?' },
    choice: { type: 'choice', instructions: 'Which?', criteria: { a: 'A' } },
    score: { type: 'score', instructions: 'How much?', criteria: ['Low', 'High'] },
  },
}
void runtime.service.evaluate(request)
// Invalid question kinds and missing choice criteria must fail before use.
// @ts-expect-error Jev has no free-text question kind.
const invalidKind: JevRequest['questions'][string] = { type: 'text', instructions: 'Write' }
// @ts-expect-error Choice questions require a label dictionary.
const missingCriteria: JevRequest['questions'][string] = { type: 'choice', instructions: 'Which?' }
// @ts-expect-error State cannot contain undefined JSON fields.
const invalidState: JevRequest['state'] = { ready: undefined }
// @ts-expect-error Caller cancellation uses an AbortSignal, not a controller.
const invalidSignal: JevRequest = { ...request, signal: new AbortController() }
function readAnswer(answer: JevAnswer) {
  if (answer.type === 'score') return answer.score
  // @ts-expect-error Non-score answers do not expose a score.
  return answer.score
}
function readResult(result: RpcResult<RpcEndpoints['status']['result']>) {
  if (result.ok) return result.value.model
  // @ts-expect-error Failed RPC results never contain a success value.
  return result.value
}
void [invalidKind, missingCriteria, invalidState, invalidSignal, readAnswer, readResult]
