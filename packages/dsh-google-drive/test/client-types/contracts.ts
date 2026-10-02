import type { Api, PickerEntry, PreviewDialogProps } from '../../client/contracts.js'
declare const request: Api
void request('session-status', { sessionId: 'root' })
void request('session-set', { sessionId: 'root', ownerId: 'owner', revision: 0, enabled: true })
// @ts-expect-error Enable mutations require the exact owner incarnation and revision.
void request('session-set', { sessionId: 'root', enabled: true })
// @ts-expect-error Revisions are numeric, not strings from external JSON.
void request('session-set', { sessionId: 'root', ownerId: 'owner', revision: '0', enabled: true })
// @ts-expect-error The browser never submits replacement cells for approval.
void request('preview-apply', { sessionId: 'root', callId: 'call', changes: [] })
declare const entry: PickerEntry
const owner: object = entry.owner
void owner
const dialog: PreviewDialogProps = {
  // @ts-expect-error A dialog needs a checked preview, not just historical status.
  status: { state: 'uncertain', requestId: 'request' },
  busy: false,
  error: '',
  act() {},
  close() {},
}
void dialog
