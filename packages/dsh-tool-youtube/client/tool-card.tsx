import React from 'react'
import type { ToolCardProps, Progress } from './contracts.ts'
import type { YoutubeCardModel } from './model.ts'
import { timestampUrl, compact, youtubeCardModel, isRecord } from './model.ts'
import { youtubeStyles } from './styles.ts'
import {
  CHUNK_STATUS,
  TRANSCRIPT_PROGRESS_CHANNEL,
  TRANSCRIPT_PROGRESS_ENDPOINT,
} from './constants.ts'
export function renderTimestampEntries(model: YoutubeCardModel) {
  if (model.parsed.timestampEntries.length === 0) return null
  return (
    <div style={youtubeStyles.timestampList} aria-label={'Timestamped results'}>
      {model.parsed.timestampEntries.slice(0, 8).map((entry, index) => {
        const href = timestampUrl(model, entry.seconds)
        const stamp =
          href === undefined ? (
            <span style={youtubeStyles.timestamp}>{entry.timestamp}</span>
          ) : (
            <a
              style={{ ...youtubeStyles.link, ...youtubeStyles.timestamp }}
              href={href}
              target={'_blank'}
              rel={'noopener noreferrer'}
            >
              {entry.timestamp}
            </a>
          )
        return (
          <div key={`${entry.timestamp}:${index}`} style={youtubeStyles.timestampRow}>
            {stamp}
            <span>{compact(entry.text, 180) ?? entry.modality ?? 'Timestamped result'}</span>
          </div>
        )
      })}
    </div>
  )
}
export function renderTranscriptProgress(model: YoutubeCardModel) {
  const info = model.progressInfo
  if (info === undefined || model.failed) return null
  const known = Number.isInteger(info.percent)
  const aria: React.HTMLAttributes<HTMLDivElement> = {
    role: 'progressbar',
    'aria-label': 'Transcript progress',
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuetext': info.label,
    ...(known ? { 'aria-valuenow': info.percent } : {}),
  }
  if (info.chunks.length === 0) {
    return (
      <div {...aria}>
        <div style={youtubeStyles.bar}>
          <div
            style={youtubeStyles.fill(
              known ? `${info.percent}%` : '34%',
              model.status.color,
              !known,
            )}
          ></div>
        </div>
      </div>
    )
  }
  return (
    <div {...aria}>
      <div style={youtubeStyles.timeline} aria-hidden={true}>
        {info.chunks.map((chunk) => {
          const state = CHUNK_STATUS[chunk.status] ?? {
            label: 'Queued',
            color: 'var(--dsw-alias-label-tertiary, #94a3b8)',
          }
          return (
            <span
              key={chunk.id ?? chunk.index}
              data-chunk-status={chunk.status}
              style={youtubeStyles.interval(
                Math.max(1, chunk.endSeconds - chunk.startSeconds),
                state.color,
                chunk.status === 'pending',
              )}
            ></span>
          )
        })}
      </div>
      <div style={youtubeStyles.context}>{info.label}</div>
    </div>
  )
}
export function YoutubeToolCard(props: ToolCardProps) {
  const { block, callId, inspect, rpc, toolName = block?.call?.name ?? block?.name } = props
  const [expanded, setExpanded] = React.useState(false)
  const [liveProgress, setLiveProgress] = React.useState<Progress | undefined>(undefined)
  const [pollMisses, setPollMisses] = React.useState(0)
  const settled = block?.kind === 'tool-result'
  React.useEffect(() => {
    if (toolName !== 'youtube_transcript' || typeof rpc?.call !== 'function') return undefined
    let active = true
    let timer: number | undefined
    const poll = async () => {
      let terminal = false
      try {
        const response = await rpc.call(TRANSCRIPT_PROGRESS_CHANNEL, TRANSCRIPT_PROGRESS_ENDPOINT, {
          callId,
        })
        if (active && response?.ok && isRecord(response.value)) {
          setLiveProgress(response.value)
          setPollMisses(0)
          terminal = response.value.phase === 'complete' || response.value.phase === 'failed'
        } else if (active) {
          setPollMisses((value) => value + 1)
        }
      } catch {
        if (active) setPollMisses((value) => value + 1)
      }
      if (active && !terminal && !settled) timer = window.setTimeout(poll, 500)
    }
    void poll()
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [rpc, callId, settled, toolName])
  const model = youtubeCardModel(toolName, block, liveProgress, pollMisses >= 6)
  const sourceHref =
    model.videoId === undefined ? undefined : `https://www.youtube.com/watch?v=${model.videoId}`
  return (
    <section
      style={youtubeStyles.card}
      data-youtube-tool={toolName}
      data-youtube-state={model.failed ? 'error' : model.settled ? 'complete' : 'running'}
    >
      <button
        type={'button'}
        style={youtubeStyles.disclosure}
        aria-expanded={expanded}
        aria-label={`${model.title}: ${model.summary}. ${expanded ? 'Collapse' : 'Expand'} details`}
        onClick={() => setExpanded((value) => !value)}
      >
        <span style={youtubeStyles.icon} aria-hidden={true}>
          {'▶'}
        </span>
        <span style={youtubeStyles.titleWrap}>
          <span style={youtubeStyles.title}>{model.title}</span>
          <span style={youtubeStyles.summary}>{model.summary}</span>
        </span>
        <span style={youtubeStyles.state(model.status.color)} aria-hidden={true}>
          <span style={youtubeStyles.dot(model.status.color)} aria-hidden={true}></span>
          {model.status.label}
        </span>
        <span style={youtubeStyles.chevron} aria-hidden={true}>
          {expanded ? '▴' : '▾'}
        </span>
      </button>
      <span
        style={youtubeStyles.srOnly}
        role={model.failed ? 'alert' : 'status'}
        aria-live={model.failed ? 'assertive' : 'polite'}
      >
        {model.summary}
      </span>
      {!expanded && toolName === 'youtube_transcript' && !model.failed && !model.settled
        ? renderTranscriptProgress(model)
        : null}
      {!expanded ? null : (
        <div style={youtubeStyles.body}>
          {model.failed ? <div style={youtubeStyles.error}>{model.failure}</div> : null}
          {model.context === undefined ? null : (toolName === 'youtube_transcript' ||
              toolName === 'youtube_watch') &&
            sourceHref !== undefined ? (
            <a
              style={youtubeStyles.link}
              href={sourceHref}
              target={'_blank'}
              rel={'noopener noreferrer'}
            >
              {compact(model.context, 240)}
            </a>
          ) : (
            <div style={youtubeStyles.context}>{compact(model.context, 240)}</div>
          )}
          {model.parsed.excerpt === undefined || model.failed ? null : (
            <p style={youtubeStyles.excerpt}>{model.parsed.excerpt}</p>
          )}
          {model.metrics.length === 0 ? null : (
            <div style={youtubeStyles.metrics}>
              {model.metrics.map((metric, index) => (
                <span key={`${metric}:${index}`} style={youtubeStyles.chip}>
                  {metric}
                </span>
              ))}
            </div>
          )}
          {model.paged ? (
            <div
              style={youtubeStyles.callout}
            >{`Preview ends here; more segments are safely archived${model.nextCursor === undefined ? '.' : ` · continue at cursor ${model.nextCursor}.`}`}</div>
          ) : null}
          {model.degraded && !model.settled ? (
            <div style={youtubeStyles.callout} role={'status'}>
              {'Live progress is unavailable; the transcript operation is still running.'}
            </div>
          ) : null}
          {toolName === 'youtube_transcript' ? renderTranscriptProgress(model) : null}
          {renderTimestampEntries(model)}
          {model.parsed.caveats.length === 0 ? null : (
            <div style={youtubeStyles.callout}>
              <strong>{'Caveats'}</strong>
              <ul style={youtubeStyles.intervalList}>
                {model.parsed.caveats.slice(0, 4).map((caveat, index) => (
                  <li key={index}>{caveat}</li>
                ))}
              </ul>
            </div>
          )}
          {typeof inspect !== 'function' ? null : (
            <div style={youtubeStyles.footer}>
              <button type={'button'} style={youtubeStyles.action} onClick={inspect}>
                {model.failed ? 'View error details' : 'View tool details'}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
export function YoutubeTranscriptToolView(props: ToolCardProps) {
  return YoutubeToolCard({ ...props, toolName: 'youtube_transcript' })
}
