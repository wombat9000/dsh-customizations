const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
])

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u

function validVideoId(value) {
  return typeof value === 'string' && VIDEO_ID.test(value)
}

export function parseYoutubeUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('url must be a non-empty YouTube URL')
  }

  let url
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('url must be a valid HTTPS YouTube URL')
  }

  if (url.protocol !== 'https:') {
    throw new Error('url must use HTTPS')
  }

  const host = url.hostname.toLowerCase().replace(/\.$/u, '')
  let videoId

  if (host === 'youtu.be') {
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length === 1) videoId = parts[0]
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v') ?? undefined
    } else {
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length === 2 && ['shorts', 'live'].includes(parts[0])) {
        videoId = parts[1]
      }
    }
  } else {
    throw new Error('url host must be youtube.com or youtu.be')
  }

  if (!validVideoId(videoId)) {
    throw new Error('url must identify one YouTube video')
  }

  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  }
}

export function timestampToSeconds(value) {
  if (typeof value !== 'string') return undefined
  const parts = value.trim().split(':')
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/u.test(part))) {
    return undefined
  }

  const numbers = parts.map(Number)
  if (numbers.some((part) => !Number.isSafeInteger(part))) return undefined
  const seconds = numbers.at(-1)
  const minutes = numbers.at(-2)
  const hours = numbers.length === 3 ? numbers[0] : 0
  if (seconds > 59 || (numbers.length === 3 && minutes > 59)) return undefined
  const total = hours * 3600 + minutes * 60 + seconds
  return Number.isSafeInteger(total) ? total : undefined
}

export function secondsToTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('timestamp seconds must be a non-negative integer')
  }
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const seconds = value % 60
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}
