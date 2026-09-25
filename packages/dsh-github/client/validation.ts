import type { ToolBlock } from '../shared/contracts.ts'
export const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
export const text = (value: unknown): string => (typeof value === 'string' ? value : '')
export const id = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 4096
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      !url.username &&
      !url.password &&
      !url.port
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}
export function rawDetails(block?: ToolBlock): string {
  const args = text(block?.call?.argsRaw) || text(block?.argsRaw)
  const result = Array.isArray(block?.content)
    ? block.content
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n')
    : ''
  return [
    args && `Arguments\n${args}`,
    result && `Result\n${result}`,
    block?.error && `Error\n${text(block.error.name)}: ${text(block.error.code)}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}
