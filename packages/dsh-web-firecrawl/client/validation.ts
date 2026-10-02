export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    env: 'launch environment',
    file: 'DSH credential store',
    'project-env': 'project .env',
    'user-env': 'user .env',
  }
  return labels[source] ?? source
}

export function apiKeyFailure(value: string) {
  if (value.length === 0 || value.trim().length === 0) return 'Enter a Firecrawl API key.'
  const trimmed = value.trim()
  if (!/^[\x21-\x7e]+$/u.test(trimmed))
    return 'Use an unquoted API key containing printable characters only.'
  if (
    /^[A-Za-z_][A-Za-z0-9_]*=/u.test(trimmed) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return 'Paste only the API key, without FIRECRAWL_API_KEY= or surrounding quotes.'
  }
}
