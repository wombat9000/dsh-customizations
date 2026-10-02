import type { GoogleDriveService } from '../../src/index.js'
import type { Proposal, ApplyResult } from '../../src/sheets-types.js'
import type { WithAccessToken } from '../../src/types.js'

declare const service: GoogleDriveService
const owner = { session: { id: 'root' } }
void service.readText(owner, { fileId: 'file', maxBytes: 42 })
// @ts-expect-error A session ID alone is not a live owner object.
void service.readText('root', { fileId: 'file' })
// @ts-expect-error Output limits are numeric, not provider-supplied strings.
void service.readText(owner, { fileId: 'file', maxBytes: '42' })
// @ts-expect-error Browser approval sends identity only, never replacement edits.
service.browser('preview-apply', { sessionId: 'root', callId: 'call', changes: [] })

declare const result: ApplyResult
if (result.status === 'uncertain') {
  const message: string = result.message
  void message
  // @ts-expect-error Uncertain writes do not claim a verified snapshot.
  void result.snapshot
}
declare const proposal: Proposal
const fileId: string = proposal.fileId
void fileId

declare const tokenAccess: WithAccessToken
const typedResult: Promise<number> = tokenAccess(async (_token, signal) => {
  signal?.throwIfAborted()
  return 1
})
void typedResult
