import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

// RC2's session-authorized readAttachment returns decoded bytes, not a provider URL.
// The browser accepts the native Uint8Array and the serialized array representation.
export interface AttachmentPayload {
  attachment: ImageAttachmentRef
  data: ArrayLike<number>
}
export type AttachmentReadResult =
  { ok: true; value: AttachmentPayload } | { ok: false; error: { code: string; message: string } }
export type ReadAttachment = (
  sessionId: string,
  attachment: ImageAttachmentRef,
) => Promise<AttachmentPayload>

export interface ToolBlock {
  kind: string
  content?: readonly unknown[]
  isError?: boolean
}
export interface ToolViewProps {
  block: ToolBlock
  sessionId: string
  readAttachment: ReadAttachment
}
