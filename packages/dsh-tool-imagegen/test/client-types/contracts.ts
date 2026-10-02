import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ReadAttachment, AttachmentReadResult, ToolViewProps } from '../../shared/contracts.ts'

declare const read: ReadAttachment
declare const attachment: ImageAttachmentRef
read('session-1', attachment)
// @ts-expect-error Reads use a durable reference, not a URL or raw attachment ID.
read('session-1', 'https://provider.test/image.png')
// @ts-expect-error An error response never exposes attachment bytes as a successful result.
const invalid: AttachmentReadResult = { ok: false, value: { attachment, data: [1, 2] } }
void invalid
// @ts-expect-error The view requires session identity for authorized attachment loading.
const view: ToolViewProps = { block: { kind: 'tool-result' }, readAttachment: read }
void view
