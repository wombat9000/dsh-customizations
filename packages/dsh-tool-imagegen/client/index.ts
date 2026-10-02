import type { ComponentType } from 'react'
import type { AttachmentReadResult, ReadAttachment, ToolViewProps } from '../shared/contracts.ts'
import { GenerateImageToolView } from './tool-view.tsx'

export { GenerateImageToolView } from './tool-view.tsx'
export { ImagePreview } from './image-preview.tsx'
export { imageBlocks, textSummary } from './content.ts'
export const inject = ['slots', 'sessions']

// Narrow consumed RC2 contract: the keyed Tool view receives block/sessionId,
// inject adds one stable reader, and slots.inject owns registration disposal.
// Session.readAttachment verifies reference ownership on the Host; no URL RPC.
export interface ClientContext {
  sessions: {
    binding(sessionId: string):
      | {
          session?: {
            readAttachment(attachmentId: string): Promise<AttachmentReadResult>
          }
        }
      | undefined
  }
  slots: {
    inject(name: 'tool.call.toolview', callback: () => () => void): unknown
    register(
      options: {
        name: 'tool.call.toolview'
        key: 'generate_image'
        inject(): { readAttachment: ReadAttachment }
      },
      component: ComponentType<ToolViewProps>,
    ): () => void
  }
}
export function apply(ctx: ClientContext) {
  const readAttachment: ReadAttachment = async (sessionId, attachment) => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding?.session === undefined)
      throw new Error(`Image session is unavailable: ${sessionId}`)
    const result = await binding.session.readAttachment(attachment.attachmentId)
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }
  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register(
      {
        name: 'tool.call.toolview',
        key: 'generate_image',
        inject: () => ({ readAttachment }),
      },
      GenerateImageToolView,
    ),
  )
}
