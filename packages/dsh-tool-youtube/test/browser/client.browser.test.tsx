import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { GeminiSettingsSection, YoutubeConfigPage } from '../../client/settings.tsx'
import { YoutubeToolCard } from '../../client/tool-card.tsx'
import type { SettingsProps, ToolCardProps } from '../../client/contracts.ts'

// Real React/DOM source tests; only credential Remote and progress RPC are mocked.
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
  vi.useRealTimers()
})

function credentials(configured = false, writable = true) {
  return {
    describe: vi.fn(async () => ({
      ok: true as const,
      value: { GEMINI_API_KEY: { configured, writable } },
    })),
    set: vi.fn(async (_ref: string, _value: string) => ({ ok: true as const, value: undefined })),
    unset: vi.fn(async (_ref: string) => ({ ok: true as const, value: undefined })),
  } satisfies SettingsProps['api']['credentials']
}
const noSubscription = () => () => {}

test('summary never requests credential status or subscribes', async () => {
  const api = { credentials: credentials() }
  const subscribe = vi.fn(noSubscription)
  await render(<YoutubeConfigPage api={api} subscribe={subscribe} view="summary" />)
  expect(container.textContent).toBe(
    'Configure Gemini access for YouTube analysis and transcripts.',
  )
  expect(api.credentials.describe).not.toHaveBeenCalled()
  expect(subscribe).not.toHaveBeenCalled()
  expect(container.querySelector('input')).toBeNull()
})

test('credential validation, trimmed write-only save, and subscription cleanup', async () => {
  const api = { credentials: credentials() }
  const dispose = vi.fn()
  const subscribe = vi.fn(() => dispose)
  await render(<GeminiSettingsSection api={api} subscribe={subscribe} view="page" />)
  const input = page.getByLabelText('API key', { exact: true })
  await act(async () => input.fill('GEMINI_API_KEY=bad'))
  await act(async () => page.getByRole('button', { name: 'Save key', exact: true }).click())
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Paste only the API key')
  expect(api.credentials.set).not.toHaveBeenCalled()
  await act(async () => input.fill('  example-key  '))
  await act(async () => page.getByRole('button', { name: 'Save key', exact: true }).click())
  expect(api.credentials.set).toHaveBeenCalledExactlyOnceWith('GEMINI_API_KEY', 'example-key')
  expect(container.querySelector('input')?.value).toBe('')
  expect(container.textContent).toContain('Gemini API key saved.')
  await unmount()
  expect(dispose).toHaveBeenCalledTimes(1)
})

test('read-only credentials remain disabled and removal requires confirmation', async () => {
  const api = { credentials: credentials(true, false) }
  await render(<GeminiSettingsSection api={api} subscribe={noSubscription} view="page" />)
  expect(container.querySelector('input')?.disabled).toBe(true)
  expect(container.textContent).toContain('read-only source')
  expect(container.textContent).not.toContain('Remove key')
  await unmount()
  const writable = { credentials: credentials(true) }
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  await render(<GeminiSettingsSection api={writable} subscribe={noSubscription} view="page" />)
  await act(async () => page.getByRole('button', { name: 'Remove key', exact: true }).click())
  expect(writable.credentials.unset).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  await act(async () => page.getByRole('button', { name: 'Remove key', exact: true }).click())
  expect(writable.credentials.unset).toHaveBeenCalledExactlyOnceWith('GEMINI_API_KEY')
})

test('tool disclosure escapes output, retains caveats, timestamp links and raw details', async () => {
  const inspect = vi.fn()
  await render(
    <YoutubeToolCard
      callId="watch-1"
      inspect={inspect}
      block={{
        kind: 'tool-result',
        call: {
          name: 'youtube_watch',
          argsRaw: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ', question: '<img src=x>' }),
        },
        content: [
          {
            type: 'text',
            text: '<script>answer</script>\nEvidence:\n- [0:12] (visual) <b>frame</b>\nCaveats:\n- sampled frames',
          },
        ],
      }}
    />,
  )
  const disclosure = page.getByRole('button', { name: /YouTube analysis: Answer ready/ })
  expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('false')
  await act(async () => disclosure.click())
  expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('true')
  expect(container.textContent).toContain('<script>answer</script>')
  expect(container.textContent).toContain('sampled frames')
  expect(container.querySelector('img, script, b')).toBeNull()
  const link = container.querySelector('a[href*="&t=12s"]')
  expect(link?.getAttribute('href')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s')
  expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
  await act(async () =>
    page.getByRole('button', { name: 'View tool details', exact: true }).click(),
  )
  expect(inspect).toHaveBeenCalledTimes(1)
})

test('live progress uses weighted intervals, stops at terminal response and cancels on unmount', async () => {
  vi.useFakeTimers()
  const call = vi
    .fn<NonNullable<ToolCardProps['rpc']>['call']>()
    .mockResolvedValueOnce({
      ok: true,
      value: {
        phase: 'transcribing',
        totalChunks: 2,
        completedChunks: 1,
        durationSeconds: 100,
        chunks: [
          { id: 'a', status: 'complete', startSeconds: 0, endSeconds: 75 },
          { id: 'b', status: 'running', startSeconds: 75, endSeconds: 100 },
        ],
      },
    })
    .mockResolvedValue({ ok: true, value: { phase: 'complete' } })
  const rpc = { call }
  await render(
    <YoutubeToolCard
      callId="transcript-1"
      rpc={rpc}
      block={{ kind: 'tool-call', name: 'youtube_transcript' }}
    />,
  )
  expect(call).toHaveBeenCalledExactlyOnceWith('/youtube-transcript-progress', 'get', {
    callId: 'transcript-1',
  })
  expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('75')
  expect(container.querySelectorAll('[data-chunk-status]')).toHaveLength(2)
  await act(async () => vi.advanceTimersByTimeAsync(500))
  expect(call).toHaveBeenCalledTimes(2)
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(call).toHaveBeenCalledTimes(2)
  await unmount()
  call.mockResolvedValue({ ok: true, value: null })
  await render(
    <YoutubeToolCard
      callId="transcript-2"
      rpc={rpc}
      block={{ kind: 'tool-call', name: 'youtube_transcript' }}
    />,
  )
  expect(call).toHaveBeenCalledTimes(3)
  await unmount()
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(call).toHaveBeenCalledTimes(3)
})

test('an old progress response cannot replace the current mounted call or restart its polling', async () => {
  vi.useFakeTimers()
  let resolve:
    ((value: Awaited<ReturnType<NonNullable<ToolCardProps['rpc']>['call']>>) => void) | undefined
  const currentProgress = {
    phase: 'transcribing',
    durationSeconds: 100,
    chunks: [
      { id: 'current-done', status: 'complete', startSeconds: 0, endSeconds: 25 },
      { id: 'current-running', status: 'running', startSeconds: 25, endSeconds: 100 },
    ],
  }
  const call = vi
    .fn<NonNullable<ToolCardProps['rpc']>['call']>()
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    .mockResolvedValue({ ok: true, value: currentProgress })
  const rpc = { call }
  await render(
    <YoutubeToolCard
      callId="old"
      rpc={rpc}
      block={{ kind: 'tool-call', name: 'youtube_transcript' }}
    />,
  )
  expect(call).toHaveBeenCalledExactlyOnceWith('/youtube-transcript-progress', 'get', {
    callId: 'old',
  })
  await render(
    <YoutubeToolCard
      callId="current"
      rpc={rpc}
      block={{ kind: 'tool-call', name: 'youtube_transcript' }}
    />,
  )
  expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('25')
  const currentText = container.textContent
  expect(resolve).toBeTypeOf('function')
  await act(async () =>
    resolve?.({
      ok: true,
      value: {
        phase: 'transcribing',
        durationSeconds: 100,
        chunks: [{ id: 'old-done', status: 'complete', startSeconds: 0, endSeconds: 100 }],
      },
    }),
  )
  expect(container.textContent).toBe(currentText)
  expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('25')
  await act(async () => vi.advanceTimersByTimeAsync(1500))
  expect(call.mock.calls.map((args) => args[2].callId)).toEqual([
    'old',
    'current',
    'current',
    'current',
    'current',
  ])
  expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('25')
})

test('six missed polls disclose degradation without inventing progress; settled calls poll once', async () => {
  vi.useFakeTimers()
  const call = vi
    .fn<NonNullable<ToolCardProps['rpc']>['call']>()
    .mockResolvedValue({ ok: true, value: null })
  const rpc = { call }
  await render(
    <YoutubeToolCard
      callId="missing"
      rpc={rpc}
      block={{ kind: 'tool-call', name: 'youtube_transcript' }}
    />,
  )
  await act(async () => vi.advanceTimersByTimeAsync(2500))
  expect(call).toHaveBeenCalledTimes(6)
  await act(async () => container.querySelector('button')?.click())
  expect(container.textContent).toContain(
    'Live progress is unavailable; the transcript operation is still running.',
  )
  expect(container.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false)
  await render(
    <YoutubeToolCard
      callId="missing"
      rpc={rpc}
      inspect={vi.fn()}
      block={{
        kind: 'tool-result',
        call: { name: 'youtube_transcript' },
        content: [],
        isError: true,
      }}
    />,
  )
  expect(call).toHaveBeenCalledTimes(7)
  expect(container.querySelector('[data-youtube-state]')?.getAttribute('data-youtube-state')).toBe(
    'error',
  )
  expect(container.querySelector('[role="progressbar"]')).toBeNull()
  expect(container.textContent).toContain('View error details')
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(call).toHaveBeenCalledTimes(7)
})

test('credential refresh ignores the stale describe result from a replaced API', async () => {
  type Result = Awaited<ReturnType<SettingsProps['api']['credentials']['describe']>>
  let resolve: ((value: Result) => void) | undefined
  const oldApi: SettingsProps['api'] = {
    credentials: {
      ...credentials(),
      describe: () =>
        new Promise<Result>((done) => {
          resolve = done
        }),
    },
  }
  const currentApi = { credentials: credentials(false) }
  await render(<GeminiSettingsSection api={oldApi} subscribe={noSubscription} view="page" />)
  expect(container.textContent).toContain('Checking…')
  await render(<GeminiSettingsSection api={currentApi} subscribe={noSubscription} view="page" />)
  expect(container.textContent).toContain('Not configured')
  await act(async () =>
    resolve?.({ ok: true, value: { GEMINI_API_KEY: { configured: true, writable: false } } }),
  )
  expect(container.textContent).toContain('Not configured')
  expect(container.querySelector('input')?.disabled).toBe(false)
})

test('describe failures remain visible as alerts without escaping the effect', async () => {
  type DescribeResult = Awaited<ReturnType<SettingsProps['api']['credentials']['describe']>>
  const envelope = {
    ok: false as const,
    error: Object.assign(new Error('Credential service unavailable'), {
      code: 'internal',
      details: {},
      isDSHRemoteError: true as const,
    }),
  } as unknown as DescribeResult
  for (const describe of [
    () => {
      throw new Error('Credential service unavailable')
    },
    async () => {
      throw new Error('Credential service unavailable')
    },
    async () => envelope,
  ]) {
    const api: SettingsProps['api'] = {
      credentials: { ...credentials(), describe },
    }
    await render(<GeminiSettingsSection api={api} subscribe={noSubscription} view="page" />)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Credential service unavailable',
    )
    expect(container.textContent).toContain('Unavailable')
    await unmount()
  }
})

test('transcript card renders recovering chunk progress and final archived outcome', async () => {
  const rpc = {
    call: vi.fn<NonNullable<ToolCardProps['rpc']>['call']>().mockResolvedValue({
      ok: true,
      value: {
        phase: 'transcribing',
        durationSeconds: 7_200,
        totalChunks: 3,
        completedChunks: 1,
        chunks: [
          { id: '1', index: 0, startSeconds: 0, endSeconds: 900, status: 'complete' },
          { id: '2', index: 1, startSeconds: 900, endSeconds: 3_600, status: 'fallback' },
          { id: '3', index: 2, startSeconds: 3_600, endSeconds: 7_200, status: 'pending' },
        ],
      },
    }),
  }
  await render(
    <YoutubeToolCard
      toolName="youtube_transcript"
      callId="call-live"
      rpc={rpc}
      block={{
        kind: 'tool-call',
        name: 'youtube_transcript',
        argsRaw: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
      }}
    />,
  )
  await act(async () => container.querySelector('button')?.click())
  expect(container.textContent).toContain('Recovering 1/3')
  expect(
    container.querySelector('[aria-label="Transcript progress"]')?.getAttribute('aria-valuenow'),
  ).toBe('13')
  expect(
    Array.from(container.querySelectorAll('[data-chunk-status]'), (el) =>
      el.getAttribute('data-chunk-status'),
    ),
  ).toEqual(['complete', 'fallback', 'pending'])

  await unmount()
  await render(
    <YoutubeToolCard
      toolName="youtube_transcript"
      callId="done"
      block={{
        kind: 'tool-result',
        isError: false,
        call: {
          name: 'youtube_transcript',
          argsRaw: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
        },
        meta: {
          phase: 'complete',
          durationSeconds: 3_600,
          truncated: true,
          result: { totalSegments: 842, nextCursor: 240 },
        },
        content: [
          {
            type: 'text',
            text: 'Language: English\nDuration: 1:00:00\n\n[0:00] Host: Hello\n\n(Inline transcript truncated at a segment boundary. Continue with youtube_transcript_read using cursor 240.)',
          },
        ],
      }}
    />,
  )
  await act(async () => container.querySelector('button')?.click())
  expect(container.textContent).toContain('Transcript ready · 1:00:00 · 842 segments')
  expect(container.textContent).toContain(
    'more segments are safely archived · continue at cursor 240',
  )
})

test('watch, read, and search cards render outcome summaries and timestamp links', async () => {
  const cases = [
    {
      toolName: 'youtube_watch',
      args: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', question: 'What happens?' },
      text: 'The presenter saves the file.\n\nEvidence:\n- [0:42] (visual) The Save button changes.\n\nCaveats:\n- Rapid events may be missed.',
      expected: /Answer ready · 1 evidence item/,
    },
    {
      toolName: 'youtube_transcript_read',
      args: { transcriptId: 'tr-1', cursor: 20 },
      text: '[1:00] Host: First\n[1:05] Guest: Second\n\n(More archived segments are available at cursor 22.)',
      expected: /2 transcript segments · more available/,
    },
    {
      toolName: 'youtube_transcript_search',
      args: { transcriptId: 'tr-1', query: 'quota' },
      text: '[2:10] Host: The quota is bounded.',
      expected: /1 match for “quota”/,
    },
  ]
  for (const item of cases) {
    await render(
      <YoutubeToolCard
        toolName={item.toolName}
        callId={item.toolName}
        block={{
          kind: 'tool-result',
          isError: false,
          call: { name: item.toolName, argsRaw: JSON.stringify(item.args) },
          content: [{ type: 'text', text: item.text }],
        }}
      />,
    )
    await act(async () => container.querySelector('button')?.click())
    expect(container.textContent).toMatch(item.expected)
    if (item.toolName === 'youtube_watch') {
      const link = container.querySelector('a[href*="&t=42s"]')
      expect(link?.getAttribute('href')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s')
      expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
    }
    await unmount()
  }
})
