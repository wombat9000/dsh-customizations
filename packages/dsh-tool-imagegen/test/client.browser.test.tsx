import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { GenerateImageToolView } from '../client/tool-view.tsx'
import { ImagePreview } from '../client/image-preview.tsx'
import type { AttachmentPayload, ReadAttachment } from '../shared/contracts.ts'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

// Real React/DOM; only session reads and object-URL allocation are fixtures.
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let root: Root | undefined
let container: HTMLElement
async function render(element: React.ReactNode) {
  if (!root) {
    container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)
  }
  const current = root
  await act(async () => current.render(element))
}
async function unmount() {
  const current = root
  if (current) await act(async () => current.unmount())
  root = undefined
  container?.remove()
}
afterEach(async () => {
  await unmount()
  vi.restoreAllMocks()
})
// The fixture ID represents an opaque reference already admitted by Host history.
const attachment: ImageAttachmentRef = {
  attachmentId: 'sha256:fixture' as ImageAttachmentRef['attachmentId'],
  mediaType: 'image/png',
  bytes: 3,
  width: 1024,
  height: 768,
  name: '<b>generated</b>.png',
}
const payload: AttachmentPayload = { attachment, data: new Uint8Array([1, 2, 3]) }
const fixtureUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6H7cAAAAASUVORK5CYII='

test('gallery retains bounded previews, escaped labels, lightbox controls and URL cleanup', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue(fixtureUrl)
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const read: ReadAttachment = vi.fn(async () => payload)
  await render(
    <GenerateImageToolView
      block={{
        kind: 'tool-result',
        content: [
          { type: 'text', text: 'Generated 1 image.' },
          { type: 'image', attachment },
        ],
      }}
      sessionId="session-1"
      readAttachment={read}
    />,
  )
  expect(read).toHaveBeenCalledExactlyOnceWith('session-1', attachment)
  expect(container.textContent).toContain('1 image')
  const preview = container.querySelector('img')
  expect(preview?.getAttribute('alt')).toBe('<b>generated</b>.png')
  expect(container.querySelector('b')).toBeNull()
  expect(preview?.style.maxHeight).toBe('420px')
  expect(preview?.getAttribute('width')).toBe('1024')
  await act(async () =>
    page
      .getByRole('button', { name: '<b>generated</b>.png, view full image', exact: true })
      .click(),
  )
  expect(container.querySelectorAll('img')).toHaveLength(2)
  const full = container.querySelectorAll('img')[1]
  await act(async () => full?.click())
  expect(container.querySelectorAll('img')).toHaveLength(2)
  await act(async () =>
    page
      .getByRole('button', { name: 'Close image preview', exact: true })
      .click({ position: { x: 5, y: 5 } }),
  )
  expect(container.querySelectorAll('img')).toHaveLength(1)
  expect(create).toHaveBeenCalledTimes(1)
  await unmount()
  expect(revoke).toHaveBeenCalledExactlyOnceWith(fixtureUrl)
})

test('failed session reads retry without changing the session or attachment', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue(fixtureUrl)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const read = vi
    .fn<ReadAttachment>()
    .mockRejectedValueOnce(new Error('denied: fixture'))
    .mockResolvedValueOnce(payload)
  await render(<ImagePreview attachment={attachment} sessionId="session-1" readAttachment={read} />)
  const retry = page.getByRole('button', { name: 'Image failed to load — retry', exact: true })
  expect(container.querySelector('button')?.title).toBe('denied: fixture')
  await act(async () => retry.click())
  expect(container.querySelector('img')?.getAttribute('src')).toBe(fixtureUrl)
  expect(read).toHaveBeenNthCalledWith(1, 'session-1', attachment)
  expect(read).toHaveBeenNthCalledWith(2, 'session-1', attachment)
})

test('late image reads never replace a newer session preview and release both URLs', async () => {
  const create = vi
    .spyOn(URL, 'createObjectURL')
    .mockReturnValueOnce(fixtureUrl)
    .mockReturnValueOnce('blob:late')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  let complete: (value: AttachmentPayload) => void = () => {
    throw new Error('read did not start')
  }
  const read: ReadAttachment = vi.fn((sessionId) =>
    sessionId === 'old-session'
      ? new Promise<AttachmentPayload>((resolve) => {
          complete = resolve
        })
      : Promise.resolve(payload),
  )
  await render(
    <ImagePreview attachment={attachment} sessionId="old-session" readAttachment={read} />,
  )
  expect(container.textContent).toContain('Loading generated image')
  await render(
    <ImagePreview attachment={attachment} sessionId="new-session" readAttachment={read} />,
  )
  await act(async () => complete(payload))
  expect(create).toHaveBeenCalledTimes(2)
  expect(container.querySelector('img')?.getAttribute('src')).toBe(fixtureUrl)
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:late')
  await unmount()
  expect(revoke).toHaveBeenCalledTimes(2)
  expect(revoke).toHaveBeenLastCalledWith(fixtureUrl)
})

test('data-URL fallback keeps image MIME and bytes without revoking a non-object URL', async () => {
  vi.stubGlobal('URL', { revokeObjectURL: vi.fn() })
  try {
    await render(
      <ImagePreview
        attachment={attachment}
        sessionId="session-1"
        readAttachment={async () => payload}
      />,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AQID')
    await unmount()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  }
})
