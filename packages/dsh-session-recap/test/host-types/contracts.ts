import { RecapRuntime } from '../../src/runtime.js'
import { parseCards, parseRecap } from '../../src/recap-schema.js'
import { normalizeSettings } from '../../src/settings.js'
import { evaluateCardSelection } from '../../src/cards.js'
import type { PreparedCall, StreamChunk, Writer } from '../../src/host-types.js'
import type { RecapResult, RpcEndpoints, SelectionDiagnostics } from '../../shared/contracts.js'

// These assert actual producer/consumer boundaries, not compiler configuration.
export async function contracts(runtime: RecapRuntime, writer: Writer, prepared: PreparedCall) {
  const result: RpcEndpoints['recap']['result'] = await runtime.recap({ sessionId: 's' })
  const activity: RpcEndpoints['activity']['result'] = runtime.activity({ sessionId: 's' })
  const diagnostics: SelectionDiagnostics = evaluateCardSelection({}).diagnostics
  const settings = normalizeSettings({ provider: 'fixture', model: 'summary' })
  const bullets = parseRecap('{"bullets":["Context"]}')
  const cards = parseCards('{"headline":"Context","cards":{"direction":"Continue"}}', ['direction'])
  // @ts-expect-error Backend settings must agree with the frontend boolean contract.
  settings.autoRecap = 'enabled'
  // @ts-expect-error Only supported card labels cross the wire.
  parseCards('{}', ['invented'])
  // @ts-expect-error A backend result cannot omit selection provenance.
  const incomplete: RecapResult = {
    sessionId: 's',
    revision: 1,
    recap: bullets,
    generatedAt: '',
    cached: false,
  }
  // @ts-expect-error Invalid writer configuration must not pass the service boundary.
  await writer.prepareCall({ provider: 'p', model: 1 }, new AbortController().signal)
  // @ts-expect-error A finish chunk always carries its outcome.
  const finish: StreamChunk = { type: 'finish' }
  // @ts-expect-error Model output text cannot become an object.
  const text: StreamChunk = { type: 'text-delta', text: {} }
  // @ts-expect-error A prepared stream request requires cancellation and explicit no-tools scope.
  prepared.stream({ ...prepared.config, system: '', messages: [] })
  // @ts-expect-error Readonly backend selection diagnostics cannot be mutated by a client.
  diagnostics.categories.push({})
  void [result, activity, diagnostics, cards, incomplete, finish, text]
}
