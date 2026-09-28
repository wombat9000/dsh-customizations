export const CREDENTIAL_REF = 'GEMINI_API_KEY'
export const TRANSCRIPT_PROGRESS_CHANNEL = '/youtube-transcript-progress'
export const TRANSCRIPT_PROGRESS_ENDPOINT = 'get'
export const YOUTUBE_TOOLS = [
  'youtube_watch',
  'youtube_transcript',
  'youtube_transcript_read',
  'youtube_transcript_search',
]
export const TOOL_LABELS: Record<string, string> = {
  youtube_watch: 'YouTube analysis',
  youtube_transcript: 'YouTube transcript',
  youtube_transcript_read: 'Transcript page',
  youtube_transcript_search: 'Transcript search',
}
export const STATE_COLORS = {
  running: 'var(--dsw-alias-label-accent, #3b82f6)',
  ok: 'var(--dsw-alias-label-success, #16a34a)',
  error: 'var(--dsw-alias-label-error, #dc2626)',
  warning: 'var(--dsw-alias-label-warning, #b45309)',
  neutral: 'var(--dsw-alias-label-secondary)',
}
export const CHUNK_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Queued', color: 'var(--dsw-alias-label-tertiary, #94a3b8)' },
  transcribing: { label: 'Transcribing', color: STATE_COLORS.running },
  fallback: { label: 'Provider fallback', color: STATE_COLORS.warning },
  neutral: { label: 'Neutral retry', color: STATE_COLORS.warning },
  splitting: { label: 'Splitting', color: 'var(--dsw-alias-label-accent, #7c3aed)' },
  complete: { label: 'Complete', color: STATE_COLORS.ok },
  failed: { label: 'Failed', color: STATE_COLORS.error },
}
