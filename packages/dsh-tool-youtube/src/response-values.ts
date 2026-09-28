export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Gemini returned an invalid ${name}`)
  }
  return value.trim()
}

export function stringList(value: unknown, name: string, maxItems = 100, maxItemChars = 2_000) {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`Gemini returned an invalid ${name}`)
  }
  const normalized = [...new Set(value.map((item) => item.trim()).filter(Boolean))]
  if (normalized.length > maxItems || normalized.some((item) => item.length > maxItemChars)) {
    throw new Error(`Gemini returned an oversized ${name}`)
  }
  return normalized
}

export function boundedText(value: string, maxChars: number) {
  if (value.length <= maxChars) return { text: value, truncated: false }
  const prefix = value.slice(0, maxChars).trimEnd()
  const lastSpace = prefix.lastIndexOf(' ')
  return {
    text: (lastSpace >= Math.floor(maxChars * 0.75)
      ? prefix.slice(0, lastSpace)
      : prefix
    ).trimEnd(),
    truncated: true,
  }
}
