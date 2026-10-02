export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    env: 'launch environment',
    file: 'DSH credential store',
    'project-env': 'project .env',
    'user-env': 'user .env',
    composition: 'profile composition',
  }
  return labels[source] ?? source
}
