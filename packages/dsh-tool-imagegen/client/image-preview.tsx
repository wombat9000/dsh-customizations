import React, { useEffect, useState } from 'react'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { AttachmentPayload, ReadAttachment } from '../shared/contracts.ts'
import { styles } from './styles.ts'

interface ImageUrl {
  url: string
  disposable: boolean
}
function imageUrl(payload: AttachmentPayload): ImageUrl {
  const bytes = Uint8Array.from(payload.data)
  const mediaType = payload.attachment?.mediaType || 'application/octet-stream'
  if (typeof URL.createObjectURL !== 'function') {
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return { url: `data:${mediaType};base64,${btoa(binary)}`, disposable: false }
  }
  return {
    url: URL.createObjectURL(new Blob([bytes.buffer], { type: mediaType })),
    disposable: true,
  }
}
export function ImagePreview({
  attachment,
  sessionId,
  readAttachment,
}: {
  attachment: ImageAttachmentRef
  sessionId: string
  readAttachment: ReadAttachment
}) {
  const [src, setSrc] = useState<string>()
  const [failure, setFailure] = useState<string>()
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    let loaded: ImageUrl | undefined
    setSrc(undefined)
    setFailure(undefined)
    Promise.resolve(readAttachment(sessionId, attachment)).then(
      (payload) => {
        loaded = imageUrl(payload)
        if (!active) {
          if (loaded.disposable) URL.revokeObjectURL(loaded.url)
          return
        }
        setSrc(loaded.url)
      },
      (error: unknown) => {
        if (active) setFailure(error instanceof Error ? error.message : String(error))
      },
    )
    return () => {
      active = false
      if (loaded?.disposable) URL.revokeObjectURL(loaded.url)
    }
  }, [attachment.attachmentId, sessionId, readAttachment, attempt])

  if (failure !== undefined) {
    return (
      <button
        type="button"
        style={{ ...styles.placeholder, ...styles.error }}
        title={failure}
        onClick={() => setAttempt((value) => value + 1)}
      >
        Image failed to load — retry
      </button>
    )
  }
  if (src === undefined) return <div style={styles.placeholder}>Loading generated image…</div>

  const label = attachment.name || 'Generated image'
  return (
    <>
      <button
        type="button"
        style={styles.frame}
        title="View full image"
        aria-label={`${label}, view full image`}
        onClick={() => setOpen(true)}
      >
        <img
          src={src}
          alt={label}
          style={styles.image}
          width={attachment.width}
          height={attachment.height}
        />
      </button>
      {open ? (
        <button
          type="button"
          style={styles.backdrop}
          aria-label="Close image preview"
          onClick={() => setOpen(false)}
        >
          <img
            src={src}
            alt={label}
            style={styles.fullImage}
            onClick={(event) => event.stopPropagation()}
          />
        </button>
      ) : null}
    </>
  )
}
