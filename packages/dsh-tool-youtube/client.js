window.__ModuleLoader__.load({
  id: '@local/dsh-tool-youtube',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    const CREDENTIAL_REF = 'GEMINI_API_KEY'
    const TRANSCRIPT_PROGRESS_CHANNEL = '/youtube-transcript-progress'
    const TRANSCRIPT_PROGRESS_ENDPOINT = 'get'

    const styles = {
      section: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        width: 'min(720px, 100%)',
      },
      heading: { margin: 0, fontSize: '20px', fontWeight: 650 },
      intro: { margin: 0, opacity: 0.72, lineHeight: 1.5 },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '18px',
        border: '1px solid color-mix(in srgb, currentColor 16%, transparent)',
        borderRadius: '12px',
        background: 'color-mix(in srgb, currentColor 3%, transparent)',
      },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
      title: { margin: 0, fontSize: '16px', fontWeight: 650 },
      badge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '7px',
        fontSize: '13px',
        opacity: 0.82,
      },
      dot: (configured) => ({
        width: '8px',
        height: '8px',
        borderRadius: '999px',
        background: configured ? '#22c55e' : '#ef4444',
      }),
      label: { display: 'flex', flexDirection: 'column', gap: '7px', fontSize: '13px', fontWeight: 600 },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        border: '1px solid color-mix(in srgb, currentColor 22%, transparent)',
        borderRadius: '8px',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        padding: '10px 12px',
      },
      hint: { margin: 0, fontSize: '13px', opacity: 0.68, lineHeight: 1.45 },
      actions: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
      button: {
        border: '1px solid color-mix(in srgb, currentColor 22%, transparent)',
        borderRadius: '8px',
        background: 'color-mix(in srgb, currentColor 8%, transparent)',
        color: 'inherit',
        font: 'inherit',
        fontWeight: 600,
        padding: '8px 13px',
        cursor: 'pointer',
      },
      danger: { color: '#ef4444' },
      message: (error) => ({
        margin: 0,
        fontSize: '13px',
        color: error ? '#ef4444' : '#22c55e',
      }),
    }

    const YOUTUBE_TOOLS = ['youtube_watch', 'youtube_transcript', 'youtube_transcript_read', 'youtube_transcript_search']
    const TOOL_LABELS = {
      youtube_watch: 'YouTube analysis',
      youtube_transcript: 'YouTube transcript',
      youtube_transcript_read: 'Transcript page',
      youtube_transcript_search: 'Transcript search',
    }
    const STATE_COLORS = {
      running: 'var(--dsw-alias-label-accent, #3b82f6)',
      ok: 'var(--dsw-alias-label-success, #16a34a)',
      error: 'var(--dsw-alias-label-error, #dc2626)',
      warning: 'var(--dsw-alias-label-warning, #b45309)',
      neutral: 'var(--dsw-alias-label-secondary)',
    }
    const CHUNK_STATUS = {
      pending: { label: 'Queued', color: 'var(--dsw-alias-label-tertiary, #94a3b8)' },
      transcribing: { label: 'Transcribing', color: STATE_COLORS.running },
      fallback: { label: 'Provider fallback', color: STATE_COLORS.warning },
      neutral: { label: 'Neutral retry', color: STATE_COLORS.warning },
      splitting: { label: 'Splitting', color: 'var(--dsw-alias-label-accent, #7c3aed)' },
      complete: { label: 'Complete', color: STATE_COLORS.ok },
      failed: { label: 'Failed', color: STATE_COLORS.error },
    }
    const youtubeStyles = {
      card: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px', border: '1px solid var(--dsw-alias-border-l2-darkmode-thin)', borderRadius: '12px', background: 'var(--dsw-specific-input-major)', color: 'var(--dsw-alias-label-primary)' },
      disclosure: { width: '100%', display: 'grid', gridTemplateColumns: '26px minmax(0, 1fr) auto auto', alignItems: 'center', gap: '9px', padding: 0, border: 0, background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer' },
      icon: { display: 'inline-grid', placeItems: 'center', width: '24px', height: '18px', borderRadius: '5px', background: 'var(--dsw-alias-label-error, #dc2626)', color: 'var(--dsw-alias-bg-base, #fff)', fontSize: '9px' },
      titleWrap: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' },
      title: { fontSize: '13px', fontWeight: 650 },
      summary: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' },
      state: (color) => ({ display: 'inline-flex', alignItems: 'center', gap: '5px', color, fontSize: '12px', fontWeight: 600 }),
      dot: (color) => ({ width: '7px', height: '7px', borderRadius: '50%', background: color }),
      chevron: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' },
      body: { display: 'flex', flexDirection: 'column', gap: '9px', paddingTop: '8px', borderTop: '1px solid var(--dsw-alias-border-l2-darkmode-thin)', fontSize: '13px', lineHeight: 1.45 },
      context: { color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere' },
      link: { color: 'var(--dsw-alias-label-accent, currentColor)', textDecoration: 'underline' },
      excerpt: { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
      metrics: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
      chip: { padding: '2px 7px', borderRadius: '999px', background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' },
      callout: { padding: '8px 9px', borderRadius: '8px', background: 'var(--dsw-alias-interactive-bg-hover)' },
      error: { color: 'var(--dsw-alias-label-error)', fontWeight: 550 },
      bar: { height: '6px', overflow: 'hidden', borderRadius: '999px', background: 'var(--dsw-alias-interactive-bg-hover)' },
      fill: (width, color, indeterminate) => ({ width, height: '100%', backgroundColor: color, backgroundImage: indeterminate ? 'repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, currentColor 30%, transparent) 5px 8px)' : 'none' }),
      timeline: { display: 'flex', height: '9px', overflow: 'hidden', borderRadius: '4px', background: 'var(--dsw-alias-interactive-bg-hover)' },
      interval: (weight, color, pending) => ({ flexGrow: Math.max(1, weight), flexBasis: 0, minWidth: 0, background: color, opacity: pending ? 0.4 : 1 }),
      intervalList: { margin: 0, paddingLeft: '20px', color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' },
      timestampList: { display: 'flex', flexDirection: 'column', gap: '5px' },
      timestampRow: { display: 'flex', gap: '8px', alignItems: 'baseline' },
      timestamp: { flex: '0 0 auto', fontVariantNumeric: 'tabular-nums' },
      footer: { display: 'flex', justifyContent: 'flex-end' },
      action: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-accent, currentColor)', padding: 0, font: 'inherit', cursor: 'pointer' },
      srOnly: { position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 },
    }

    function messageOf(error) {
      return error instanceof Error ? error.message : String(error)
    }

    function sourceLabel(source) {
      const labels = {
        env: 'launch environment',
        file: 'DSH credential store',
        'project-env': 'project .env',
        'user-env': 'user .env',
      }
      return labels[source] ?? source
    }

    function apiKeyFailure(value) {
      if (value.length === 0 || value.trim().length === 0) return 'Enter a Gemini API key.'
      const trimmed = value.trim()
      if (!/^[\x21-\x7e]+$/u.test(trimmed)) return 'Use an unquoted API key containing printable characters only.'
      if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(trimmed)
        || ((trimmed.startsWith('"') && trimmed.endsWith('"'))
          || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
        return 'Paste only the API key, without GEMINI_API_KEY= or surrounding quotes.'
      }
    }

    function formatDuration(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) return undefined
      const whole = Math.round(seconds)
      const hours = Math.floor(whole / 3600)
      const minutes = Math.floor((whole % 3600) / 60)
      const remainder = whole % 60
      return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
        : `${minutes}:${String(remainder).padStart(2, '0')}`
    }

    function isRecord(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }

    function argsOf(block) {
      const raw = block?.kind === 'tool-result' ? block.call?.argsRaw : block?.argsRaw
      if (typeof raw !== 'string') return {}
      try {
        const value = JSON.parse(raw)
        return isRecord(value) ? value : {}
      } catch {
        return {}
      }
    }

    function textOfResult(block) {
      if (block?.kind !== 'tool-result' || !Array.isArray(block.content)) return ''
      return block.content
        .filter((item) => isRecord(item) && item.type === 'text' && typeof item.text === 'string')
        .map((item) => item.text)
        .join('\n')
    }

    function compact(value, limit = 160) {
      if (typeof value !== 'string') return undefined
      const normalized = value.replace(/\s+/gu, ' ').trim()
      if (normalized.length === 0) return undefined
      return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1).trimEnd()}…`
    }

    function secondsOfTimestamp(value) {
      if (typeof value !== 'string') return undefined
      const parts = value.split(':').map(Number)
      if ((parts.length !== 2 && parts.length !== 3) || parts.some((part) => !Number.isSafeInteger(part) || part < 0)) return undefined
      if (parts.at(-1) > 59 || (parts.length === 3 && parts.at(-2) > 59)) return undefined
      return parts.length === 3
        ? parts[0] * 3600 + parts[1] * 60 + parts[2]
        : parts[0] * 60 + parts[1]
    }

    function outputFacts(toolName, text) {
      const lines = text.split('\n')
      const timestampEntries = lines.flatMap((line) => {
        const match = line.match(/^\s*-?\s*\[([0-9]+:[0-9]{2}(?::[0-9]{2})?)\]\s*(?:\(([^)]+)\)\s*)?(.*)$/u)
        if (match === null) return []
        return [{ timestamp: match[1], seconds: secondsOfTimestamp(match[1]), modality: match[2], text: match[3].trim() }]
      })
      const valueAfter = (label) => {
        const line = lines.find((item) => item.startsWith(`${label}: `))
        return line === undefined ? undefined : line.slice(label.length + 2).trim()
      }
      const sectionIndex = (...labels) => {
        const indexes = labels.map((label) => lines.indexOf(label)).filter((index) => index >= 0)
        return indexes.length === 0 ? lines.length : Math.min(...indexes)
      }
      const caveatIndex = lines.indexOf('Caveats:')
      const caveats = caveatIndex < 0
        ? []
        : lines.slice(caveatIndex + 1).filter((line) => line.startsWith('- ')).map((line) => line.slice(2))
      const cursorMatch = text.match(/(?:cursor|using cursor)\s+(\d+)/iu)
      let excerpt
      if (toolName === 'youtube_watch') {
        excerpt = compact(lines.slice(0, sectionIndex('Evidence:', 'Caveats:')).join(' '), 320)
      }
      return {
        excerpt,
        timestampEntries,
        caveats,
        language: valueAfter('Language'),
        transcriptId: valueAfter('Transcript archive ID'),
        source: valueAfter('Source'),
        duration: valueAfter('Duration'),
        timestampState: valueAfter('Timestamps'),
        speakers: valueAfter('Speakers'),
        nextCursor: cursorMatch === null ? undefined : Number(cursorMatch[1]),
        truncated: /(?:inline transcript truncated|more archived segments are available)/iu.test(text),
      }
    }

    function videoIdOf(args, meta) {
      const direct = meta?.video?.videoId ?? meta?.videoId
      if (typeof direct === 'string' && /^[A-Za-z0-9_-]{11}$/u.test(direct)) return direct
      if (typeof args.url !== 'string') return undefined
      const match = args.url.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})(?:[^A-Za-z0-9_-]|$)/u)
      return match?.[1]
    }

    function errorText(block, rendered) {
      if (rendered.trim().length > 0) return compact(rendered, 240)
      const candidate = block?.error?.message ?? block?.result?.error?.message ?? block?.message
      return compact(candidate, 240) ?? 'The operation failed. Open details for more information.'
    }

    function transcriptProgress(block, liveProgress) {
      const settled = block?.kind === 'tool-result'
      const meta = isRecord(block?.meta) ? block.meta : undefined
      if (!settled) return liveProgress ?? { phase: 'inspecting' }
      if (block.isError === true) return { ...(liveProgress ?? {}), phase: 'failed' }
      if (meta?.phase === 'complete') {
        return Array.isArray(meta.chunks)
          ? meta
          : { ...(liveProgress ?? {}), ...meta, phase: 'complete' }
      }
      return { ...(liveProgress ?? {}), phase: 'complete' }
    }

    function progressFacts(progress) {
      const chunks = Array.isArray(progress?.chunks)
        ? progress.chunks.map((chunk) => ({ ...chunk, status: chunk.status === 'running' ? 'transcribing' : chunk.status }))
            .sort((left, right) => left.startSeconds - right.startSeconds)
        : []
      const total = Number.isInteger(progress?.totalChunks) ? progress.totalChunks : undefined
      const completed = Number.isInteger(progress?.completedChunks) ? progress.completedChunks : 0
      let percent
      if (chunks.length > 0 && Number.isFinite(progress.durationSeconds) && progress.durationSeconds > 0) {
        const completedSeconds = chunks.reduce((sum, chunk) => sum + (chunk.status === 'complete' ? Math.max(0, chunk.endSeconds - chunk.startSeconds) : 0), 0)
        percent = Math.max(0, Math.min(100, Math.round(completedSeconds / progress.durationSeconds * 100)))
      } else if (total !== undefined && total > 0) {
        percent = Math.max(0, Math.min(100, Math.round(completed / total * 100)))
      } else if (progress?.phase === 'complete') {
        percent = 100
      }
      const recovering = chunks.some((chunk) => ['fallback', 'neutral', 'splitting'].includes(chunk.status))
      const phase = progress?.phase ?? 'inspecting'
      const label = phase === 'complete' ? 'Complete'
        : phase === 'failed' ? 'Failed'
          : phase === 'merging' ? 'Finalizing transcript…'
            : phase === 'transcribing'
              ? `${recovering ? 'Recovering' : 'Transcribing'}${total === undefined ? '…' : ` ${completed}/${total}`}`
              : 'Inspecting video…'
      return { chunks, total, completed, percent, recovering, phase, label }
    }

    function youtubeCardModel(toolName, block, liveProgress, degraded = false) {
      const args = argsOf(block)
      const text = textOfResult(block)
      const parsed = outputFacts(toolName, text)
      const meta = isRecord(block?.meta) ? block.meta : {}
      const result = isRecord(meta.result) ? meta.result : meta
      const completeness = isRecord(meta.completeness) ? meta.completeness : {}
      const processing = isRecord(meta.processing) ? meta.processing : meta
      const settled = block?.kind === 'tool-result'
      const failed = settled && block.isError === true
      const progress = toolName === 'youtube_transcript' ? transcriptProgress(block, liveProgress) : undefined
      const progressInfo = progress === undefined ? undefined : progressFacts(progress)
      const videoId = videoIdOf(args, meta)
      const duration = formatDuration(result.durationSeconds ?? processing.durationSeconds) ?? parsed.duration
      const totalSegments = Number.isInteger(result.totalSegments) ? result.totalSegments : undefined
      const shownSegments = parsed.timestampEntries.length
      const evidenceCount = Number.isInteger(result.evidenceCount)
        ? result.evidenceCount
        : toolName === 'youtube_watch' ? parsed.timestampEntries.length : undefined
      const matchCount = Number.isInteger(result.matchCount)
        ? result.matchCount
        : toolName === 'youtube_transcript_search' ? shownSegments : undefined
      const nextCursor = Number.isInteger(completeness.nextCursor) ? completeness.nextCursor
        : Number.isInteger(result.nextCursor) ? result.nextCursor : parsed.nextCursor
      const inlineComplete = completeness.inlineComplete ?? result.inlineComplete
      const paged = inlineComplete === false || result.truncated === true || meta.truncated === true || parsed.truncated
      const source = processing.source ?? result.source ?? parsed.source
      const failure = failed ? errorText(block, text) : undefined
      let summary
      if (failed) {
        summary = `${TOOL_LABELS[toolName] ?? 'YouTube operation'} failed · ${failure}`
      } else if (!settled) {
        if (toolName === 'youtube_transcript') summary = progressInfo.label
        else if (toolName === 'youtube_watch') summary = 'Analyzing video…'
        else if (toolName === 'youtube_transcript_read') summary = 'Reading archived transcript…'
        else summary = 'Searching archived transcript…'
      } else if (toolName === 'youtube_watch') {
        summary = `Answer ready${evidenceCount === undefined ? '' : ` · ${evidenceCount} evidence item${evidenceCount === 1 ? '' : 's'}`}`
      } else if (toolName === 'youtube_transcript') {
        const segments = totalSegments ?? shownSegments
        summary = `Transcript ready${duration === undefined ? '' : ` · ${duration}`}${segments === 0 ? '' : ` · ${segments} segment${segments === 1 ? '' : 's'}${totalSegments === undefined && paged ? ' shown' : ''}`}`
      } else if (toolName === 'youtube_transcript_read') {
        summary = `${shownSegments} transcript segment${shownSegments === 1 ? '' : 's'}${paged ? ' · more available' : ''}`
      } else {
        summary = matchCount === 0 ? `No matches for “${compact(args.query, 50) ?? ''}”` : `${matchCount} match${matchCount === 1 ? '' : 'es'} for “${compact(args.query, 50) ?? ''}”`
      }
      const status = failed ? { label: 'Failed', color: STATE_COLORS.error }
        : settled ? { label: 'Ready', color: STATE_COLORS.ok }
          : progressInfo?.recovering ? { label: 'Recovering', color: STATE_COLORS.warning }
            : { label: 'Running', color: STATE_COLORS.running }
      const context = toolName === 'youtube_watch' ? args.question
        : toolName === 'youtube_transcript' ? args.url
          : toolName === 'youtube_transcript_read'
            ? `${args.transcriptId ?? 'Transcript'}${args.startSeconds === undefined && args.endSeconds === undefined ? '' : ` · ${formatDuration(args.startSeconds ?? 0)}–${formatDuration(args.endSeconds) ?? 'end'}`}`
            : `${args.transcriptId ?? 'Transcript'}${typeof args.query === 'string' ? ` · “${args.query}”` : ''}`
      const metrics = []
      if (duration !== undefined) metrics.push(duration)
      if (parsed.language !== undefined) metrics.push(parsed.language)
      if (parsed.timestampState !== undefined) metrics.push(`Timestamps ${parsed.timestampState}`)
      if (source !== undefined) metrics.push(source === 'archive' ? 'From archive' : source === 'shared-in-flight' ? 'Shared generation' : String(source))
      if (toolName === 'youtube_transcript' && totalSegments !== undefined) metrics.push(`${totalSegments} segments`)
      if (parsed.speakers !== undefined) metrics.push(`Speakers: ${parsed.speakers}`)
      return {
        toolName, title: TOOL_LABELS[toolName] ?? 'YouTube', args, text, parsed, result, completeness,
        processing, settled, failed, failure, summary, status, context, videoId, duration, totalSegments,
        shownSegments, evidenceCount, matchCount, nextCursor, paged, source, metrics, progressInfo, degraded,
      }
    }

    function timestampUrl(model, seconds) {
      if (model.videoId === undefined || !Number.isSafeInteger(seconds)) return undefined
      return `https://www.youtube.com/watch?v=${model.videoId}&t=${seconds}s`
    }

    function renderTimestampEntries(model) {
      if (model.parsed.timestampEntries.length === 0) return null
      return React.createElement('div', { style: youtubeStyles.timestampList, 'aria-label': 'Timestamped results' },
        model.parsed.timestampEntries.slice(0, 8).map((entry, index) => {
          const href = timestampUrl(model, entry.seconds)
          const stamp = href === undefined
            ? React.createElement('span', { style: youtubeStyles.timestamp }, entry.timestamp)
            : React.createElement('a', { style: { ...youtubeStyles.link, ...youtubeStyles.timestamp }, href, target: '_blank', rel: 'noopener noreferrer' }, entry.timestamp)
          return React.createElement('div', { key: `${entry.timestamp}:${index}`, style: youtubeStyles.timestampRow }, stamp,
            React.createElement('span', null, compact(entry.text, 180) ?? entry.modality ?? 'Timestamped result'))
        }))
    }

    function renderTranscriptProgress(model) {
      const info = model.progressInfo
      if (info === undefined || model.failed) return null
      const known = Number.isInteger(info.percent)
      const aria = {
        role: 'progressbar',
        'aria-label': 'Transcript progress',
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuetext': info.label,
        ...(known ? { 'aria-valuenow': info.percent } : {}),
      }
      if (info.chunks.length === 0) {
        return React.createElement('div', aria,
          React.createElement('div', { style: youtubeStyles.bar },
            React.createElement('div', { style: youtubeStyles.fill(known ? `${info.percent}%` : '34%', model.status.color, !known) })))
      }
      return React.createElement('div', aria,
        React.createElement('div', { style: youtubeStyles.timeline, 'aria-hidden': true }, info.chunks.map((chunk) => {
          const state = CHUNK_STATUS[chunk.status] ?? CHUNK_STATUS.pending
          return React.createElement('span', {
            key: chunk.id ?? chunk.index,
            'data-chunk-status': chunk.status,
            style: youtubeStyles.interval(Math.max(1, chunk.endSeconds - chunk.startSeconds), state.color, chunk.status === 'pending'),
          })
        })),
        React.createElement('div', { style: youtubeStyles.context }, info.label))
    }

    function YoutubeToolCard(props) {
      const { block, callId, inspect, rpc, toolName = block?.call?.name ?? block?.name } = props
      const [expanded, setExpanded] = React.useState(false)
      const [liveProgress, setLiveProgress] = React.useState(undefined)
      const [pollMisses, setPollMisses] = React.useState(0)
      const settled = block?.kind === 'tool-result'

      React.useEffect(() => {
        if (toolName !== 'youtube_transcript' || typeof rpc?.call !== 'function') return undefined
        let active = true
        let timer
        const poll = async () => {
          let terminal = false
          try {
            const response = await rpc.call(TRANSCRIPT_PROGRESS_CHANNEL, TRANSCRIPT_PROGRESS_ENDPOINT, { callId })
            if (active && response?.ok && response.value !== null) {
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
      const sourceHref = model.videoId === undefined
        ? undefined
        : `https://www.youtube.com/watch?v=${model.videoId}`
      return React.createElement('section', {
        style: youtubeStyles.card,
        'data-youtube-tool': toolName,
        'data-youtube-state': model.failed ? 'error' : model.settled ? 'complete' : 'running',
      },
      React.createElement('button', {
        type: 'button', style: youtubeStyles.disclosure, 'aria-expanded': expanded,
        'aria-label': `${model.title}: ${model.summary}. ${expanded ? 'Collapse' : 'Expand'} details`,
        onClick: () => setExpanded((value) => !value),
      },
      React.createElement('span', { style: youtubeStyles.icon, 'aria-hidden': true }, '▶'),
      React.createElement('span', { style: youtubeStyles.titleWrap },
        React.createElement('span', { style: youtubeStyles.title }, model.title),
        React.createElement('span', { style: youtubeStyles.summary }, model.summary)),
      React.createElement('span', { style: youtubeStyles.state(model.status.color), 'aria-hidden': true },
        React.createElement('span', { style: youtubeStyles.dot(model.status.color), 'aria-hidden': true }), model.status.label),
      React.createElement('span', { style: youtubeStyles.chevron, 'aria-hidden': true }, expanded ? '▴' : '▾')),
      React.createElement('span', {
        style: youtubeStyles.srOnly,
        role: model.failed ? 'alert' : 'status',
        'aria-live': model.failed ? 'assertive' : 'polite',
      }, model.summary),
      !expanded && toolName === 'youtube_transcript' && !model.failed && !model.settled
        ? renderTranscriptProgress(model)
        : null,
      !expanded ? null : React.createElement('div', { style: youtubeStyles.body },
        model.failed ? React.createElement('div', { style: youtubeStyles.error }, model.failure) : null,
        model.context === undefined ? null
          : (toolName === 'youtube_transcript' || toolName === 'youtube_watch') && sourceHref !== undefined
            ? React.createElement('a', { style: youtubeStyles.link, href: sourceHref, target: '_blank', rel: 'noopener noreferrer' }, compact(model.context, 240))
            : React.createElement('div', { style: youtubeStyles.context }, compact(model.context, 240)),
        model.parsed.excerpt === undefined || model.failed ? null : React.createElement('p', { style: youtubeStyles.excerpt }, model.parsed.excerpt),
        model.metrics.length === 0 ? null : React.createElement('div', { style: youtubeStyles.metrics }, model.metrics.map((metric, index) => React.createElement('span', { key: `${metric}:${index}`, style: youtubeStyles.chip }, metric))),
        model.paged ? React.createElement('div', { style: youtubeStyles.callout }, `Preview ends here; more segments are safely archived${model.nextCursor === undefined ? '.' : ` · continue at cursor ${model.nextCursor}.`}`) : null,
        model.degraded && !model.settled ? React.createElement('div', { style: youtubeStyles.callout, role: 'status' }, 'Live progress is unavailable; the transcript operation is still running.') : null,
        toolName === 'youtube_transcript' ? renderTranscriptProgress(model) : null,
        renderTimestampEntries(model),
        model.parsed.caveats.length === 0 ? null : React.createElement('div', { style: youtubeStyles.callout },
          React.createElement('strong', null, 'Caveats'),
          React.createElement('ul', { style: youtubeStyles.intervalList }, model.parsed.caveats.slice(0, 4).map((caveat, index) => React.createElement('li', { key: index }, caveat)))),
        typeof inspect !== 'function' ? null : React.createElement('div', { style: youtubeStyles.footer },
          React.createElement('button', { type: 'button', style: youtubeStyles.action, onClick: inspect }, model.failed ? 'View error details' : 'View tool details'))))
    }

    function YoutubeTranscriptToolView(props) {
      return YoutubeToolCard({ ...props, toolName: 'youtube_transcript' })
    }

    function GeminiSettingsSection(props) {
      const { api, subscribe } = props
      const [credential, setCredential] = React.useState(undefined)
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [failure, setFailure] = React.useState(undefined)
      const [success, setSuccess] = React.useState(undefined)
      const [revision, setRevision] = React.useState(0)

      React.useEffect(() => subscribe(() => setRevision((value) => value + 1)), [subscribe])

      React.useEffect(() => {
        let active = true
        setFailure(undefined)
        api.credentials.describe({ refs: [CREDENTIAL_REF] }).then((response) => {
          if (!active) return
          if (!response.result.ok) {
            setCredential(null)
            setFailure(response.result.error.message)
            return
          }
          setCredential(response.result.value.credentials[CREDENTIAL_REF] ?? {
            configured: false,
            writable: false,
          })
        }, (error) => {
          if (!active) return
          setCredential(null)
          setFailure(messageOf(error))
        })
        return () => { active = false }
      }, [api, revision])

      const save = async () => {
        const validation = apiKeyFailure(draft)
        if (validation !== undefined) {
          setFailure(validation)
          setSuccess(undefined)
          return
        }
        setBusy(true)
        setFailure(undefined)
        setSuccess(undefined)
        try {
          const response = await api.credentials.set({ ref: CREDENTIAL_REF, value: draft.trim() })
          if (!response.result.ok) {
            setFailure(response.result.error.message)
            return
          }
          setDraft('')
          setSuccess('Gemini API key saved. The next YouTube request will use it.')
          setRevision((value) => value + 1)
        } catch (error) {
          setFailure(messageOf(error))
        } finally {
          setBusy(false)
        }
      }

      const remove = async () => {
        if (!window.confirm('Remove the stored Gemini API key?')) return
        setBusy(true)
        setFailure(undefined)
        setSuccess(undefined)
        try {
          const response = await api.credentials.unset({ ref: CREDENTIAL_REF })
          if (!response.result.ok) {
            setFailure(response.result.error.message)
            return
          }
          setDraft('')
          setSuccess('Stored Gemini API key removed.')
          setRevision((value) => value + 1)
        } catch (error) {
          setFailure(messageOf(error))
        } finally {
          setBusy(false)
        }
      }

      const configured = credential?.configured === true
      const writable = credential?.writable === true
      const source = credential?.source === undefined ? undefined : sourceLabel(credential.source)
      const status = credential === undefined
        ? 'Checking…'
        : credential === null
          ? 'Unavailable'
          : configured
            ? `Configured${source === undefined ? '' : ` via ${source}`}`
            : 'Not configured'

      return React.createElement('section', { style: styles.section, 'aria-labelledby': 'youtube-settings-title' },
        React.createElement('h2', { id: 'youtube-settings-title', style: styles.heading }, 'YouTube'),
        React.createElement('p', { style: styles.intro },
          'Configure Gemini access used by the youtube_watch and youtube_transcript tools.'),
        React.createElement('div', { style: styles.card, role: 'group', 'aria-labelledby': 'gemini-card-title' },
          React.createElement('div', { style: styles.row },
            React.createElement('h3', { id: 'gemini-card-title', style: styles.title }, 'Gemini'),
            React.createElement('span', { style: styles.badge, role: 'status' },
              React.createElement('span', { style: styles.dot(configured), 'aria-hidden': 'true' }),
              status)),
          React.createElement('label', { style: styles.label },
            configured ? 'Replace API key' : 'API key',
            React.createElement('input', {
              type: 'password',
              value: draft,
              disabled: busy || !writable,
              autoComplete: 'off',
              spellCheck: false,
              placeholder: configured ? 'Enter a new key' : 'AIza…',
              style: styles.input,
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !busy && writable) void save()
              },
            })),
          React.createElement('p', { style: styles.hint },
            writable
              ? 'The key is sent write-only to DSH’s credential store and is never returned to this page.'
              : configured
                ? 'This key comes from a read-only source. Remove it from that source before managing it here.'
                : 'Credential writes are unavailable from this browser. Open DSH on its loopback URL.'),
          React.createElement('div', { style: styles.actions },
            React.createElement('button', {
              type: 'button',
              disabled: busy || !writable,
              style: { ...styles.button, opacity: busy || !writable ? 0.5 : 1 },
              onClick: () => { void save() },
            }, busy ? 'Saving…' : configured ? 'Replace key' : 'Save key'),
            configured && writable
              ? React.createElement('button', {
                  type: 'button',
                  disabled: busy,
                  style: { ...styles.button, ...styles.danger, opacity: busy ? 0.5 : 1 },
                  onClick: () => { void remove() },
                }, 'Remove key')
              : null),
          failure === undefined ? null
            : React.createElement('p', { style: styles.message(true), role: 'alert' }, failure),
          success === undefined ? null
            : React.createElement('p', { style: styles.message(false), role: 'status' }, success)))
    }

    const inject = ['slots', 'connection', 'remote']

    function apply(ctx) {
      const connection = ctx.get('connection')
      const subscribe = (listener) => {
        const disposers = [
          ctx.remote.$on('credentials/reference-updated', (ref) => {
            if (ref === CREDENTIAL_REF) listener()
          }),
          ctx.on('connection/reset', listener),
        ]
        return () => {
          for (const dispose of disposers) dispose()
        }
      }
      const injected = () => ({ api: connection.api, subscribe })
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'youtube',
        order: 30,
        label: 'YouTube',
        inject: injected,
      }, GeminiSettingsSection))
      ctx.slots.inject('tool.call.toolview', () => {
        const disposers = YOUTUBE_TOOLS.map((key) => ctx.slots.register({
          name: 'tool.call.toolview',
          key,
          locale: 'conversation',
          inject: () => ({ rpc: connection.rpc }),
        }, YoutubeToolCard))
        return () => {
          for (const dispose of disposers.toReversed()) dispose()
        }
      })
    }

    exports.CREDENTIAL_REF = CREDENTIAL_REF
    exports.apply = apply
    exports.inject = inject
    exports.apiKeyFailure = apiKeyFailure
    exports.GeminiSettingsSection = GeminiSettingsSection
    exports.YoutubeToolCard = YoutubeToolCard
    exports.YoutubeTranscriptToolView = YoutubeTranscriptToolView
    exports.argsOf = argsOf
    exports.outputFacts = outputFacts
    exports.youtubeCardModel = youtubeCardModel
    return module.exports
  },
})
