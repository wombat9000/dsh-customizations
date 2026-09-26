import { RecapError } from './errors.js'
import type { Settings } from '../shared/contracts.js'

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
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

export function normalizeSettings(value: unknown = {}): Settings {
  // Box unknown input before spreading: preserve null/primitive behavior without
  // Object.assign's special __proto__ setter handling for untrusted own keys.
  const overrides: object = Object(value)
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS, ...overrides }
  if (
    typeof settings.autoRecap !== 'boolean' ||
    typeof settings.inactivityMinutes !== 'number' ||
    !Number.isInteger(settings.inactivityMinutes) ||
    settings.inactivityMinutes < 1 ||
    settings.inactivityMinutes > 10080
  ) {
    throw new RecapError(
      'invalid-settings',
      'Use an inactivity interval between 1 and 10080 minutes.',
    )
  }
  if (typeof settings.useJev !== 'boolean') {
    throw new RecapError('invalid-settings', 'Use a boolean for Jev selection.')
  }
  const identifiers = { provider: '', model: '' }
  for (const key of ['provider', 'model'] as const) {
    const identifier = settings[key]
    if (
      typeof identifier !== 'string' ||
      identifier.length > 200 ||
      /[\x00-\x1f\x7f]/u.test(identifier)
    ) {
      throw new RecapError('invalid-settings', 'Use valid provider and model identifiers.')
    }
    identifiers[key] = identifier.trim()
  }
  return {
    autoRecap: settings.autoRecap,
    useJev: settings.useJev,
    inactivityMinutes: settings.inactivityMinutes,
    ...identifiers,
  }
}
