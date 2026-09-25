import React from 'react'
import type { ReactNode } from 'react'
import { safeUrl } from './validation.ts'
export function Link({ url, children }: { url?: unknown; children?: ReactNode }) {
  const href = safeUrl(url)
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  )
}
