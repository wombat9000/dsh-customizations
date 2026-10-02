import React from 'react'
import type { ToolViewProps } from '../shared/contracts.ts'
import { imageBlocks, textSummary } from './content.ts'
import { ImagePreview } from './image-preview.tsx'
import { styles } from './styles.ts'

export function GenerateImageToolView({ block, sessionId, readAttachment }: ToolViewProps) {
  if (block.kind !== 'tool-result') {
    return (
      <div style={styles.card}>
        <div style={styles.header}>
          <span style={styles.title}>Generating image…</span>
        </div>
      </div>
    )
  }
  const images = imageBlocks(block)
  const summary = textSummary(block)
  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={styles.title}>
          {block.isError ? 'Image generation failed' : 'Generated image'}
        </span>
        {images.length > 0 ? (
          <span>
            {images.length} image{images.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>
      {images.length > 0 ? (
        <div style={styles.gallery}>
          {images.map((image, index) => (
            <ImagePreview
              key={`${image.attachment.attachmentId}:${index}`}
              attachment={image.attachment}
              sessionId={sessionId}
              readAttachment={readAttachment}
            />
          ))}
        </div>
      ) : (
        <div
          style={block.isError ? { ...styles.placeholder, ...styles.error } : styles.placeholder}
        >
          {summary || 'No image returned.'}
        </div>
      )}
    </div>
  )
}
