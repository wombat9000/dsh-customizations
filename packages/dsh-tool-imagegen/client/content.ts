import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}
function isAttachment(value: unknown): value is ImageAttachmentRef {
  // References come from durable session history. This checks their display shape;
  // only the Host's session-addressed read authorizes access to the opaque ID.
  return (
    object(value) &&
    typeof value.attachmentId === 'string' &&
    typeof value.mediaType === 'string' &&
    ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(value.mediaType) &&
    typeof value.bytes === 'number' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    (value.name === undefined || typeof value.name === 'string')
  )
}
function content(block: unknown): unknown[] {
  if (!object(block) || block.kind !== 'tool-result' || !Array.isArray(block.content)) return []
  return block.content
}
export function imageBlocks(
  block: unknown,
): Array<{ type: 'image'; attachment: ImageAttachmentRef }> {
  return content(block).filter(
    (item): item is { type: 'image'; attachment: ImageAttachmentRef } =>
      object(item) && item.type === 'image' && isAttachment(item.attachment),
  )
}
export function textSummary(block: unknown): string | undefined {
  const item = content(block).find(
    (candidate) =>
      object(candidate) && candidate.type === 'text' && typeof candidate.text === 'string',
  )
  return object(item) && typeof item.text === 'string' ? item.text : undefined
}
