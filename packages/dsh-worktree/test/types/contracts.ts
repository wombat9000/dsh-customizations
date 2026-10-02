import { CHANNEL, type WorktreeRpc, type Selection } from '../../shared/contracts.ts'
import type { PanelProps } from '../../client/contracts.ts'
import { createReader } from '../../client/reader.ts'
declare const rpc: WorktreeRpc
void rpc.call(CHANNEL, 'capability', { sessionId: 'parent' })
// @ts-expect-error The read-only UI has no dispatch endpoint.
void rpc.call(CHANNEL, 'dispatch', { sessionId: 'parent' })
// @ts-expect-error Path selection cannot supply a host working directory.
void rpc.call(CHANNEL, 'snapshot', { sessionId: 'parent', cwd: '/outside' })
// @ts-expect-error Exact optional selection fields cannot be explicit undefined.
const invalidSelection: Selection = { path: undefined }
void invalidSelection
declare const props: PanelProps
createReader(props.rpc, props.sessionId, (state) => {
  // @ts-expect-error An unknown server message cannot become React markup.
  state.error = {}
})
