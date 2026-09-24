import { RecapError } from './errors.js'

export const DEFAULT_SETTINGS = Object.freeze({
  autoRecap: true,
  useJev: false,
  inactivityMinutes: 30,
  provider: '',
  model: '',
})

export const LIMITS = Object.freeze({
  inputBytes: 24000,
  messages: 40,
  blocks: 128,
  outputChars: 4000,
  fieldChars: 320,
  headlineChars: 120,
  recapChars: 600,
  cacheEntries: 100,
  concurrent: 4,
  timeoutMs: 45000,
})

export function normalizeSettings(value = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...value }
  if (
    typeof settings.autoRecap !== 'boolean' ||
    !Number.isInteger(settings.inactivityMinutes) ||
    settings.inactivityMinutes < 1 ||
    settings.inactivityMinutes > 10080
  ) {
    throw new RecapError('invalid-settings', 'Use an inactivity interval between 1 and 10080 minutes.')
  }
  if (typeof settings.useJev !== 'boolean') {
    throw new RecapError('invalid-settings', 'Use a boolean for Jev selection.')
  }
  for (const key of ['provider', 'model']) {
    if (
      typeof settings[key] !== 'string' ||
      settings[key].length > 200 ||
      /[\x00-\x1f\x7f]/u.test(settings[key])
    ) {
      throw new RecapError('invalid-settings', 'Use valid provider and model identifiers.')
    }
    settings[key] = settings[key].trim()
  }
  return {
    autoRecap: settings.autoRecap,
    useJev: settings.useJev,
    inactivityMinutes: settings.inactivityMinutes,
    provider: settings.provider,
    model: settings.model,
  }
}
