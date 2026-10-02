import type { CSSProperties } from 'react'
export const styles = {
  card: {
    display: 'block',
    padding: '18px',
    border: '1px solid color-mix(in srgb, currentColor 16%, transparent)',
    borderRadius: '12px',
    background: 'color-mix(in srgb, currentColor 3%, transparent)',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    marginTop: '16px',
    width: 'min(720px, 100%)',
  },
  title: { margin: 0, fontSize: '16px', fontWeight: 650 },
  hint: { margin: 0, fontSize: '13px', opacity: 0.75, lineHeight: 1.45 },
  actions: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
  button: {
    border: '1px solid color-mix(in srgb, currentColor 22%, transparent)',
    borderRadius: '8px',
    background: 'color-mix(in srgb, currentColor 8%, transparent)',
    color: 'inherit',
    font: 'inherit',
    padding: '8px 13px',
    cursor: 'pointer',
  },
} satisfies Record<string, CSSProperties>
export const external = { target: '_blank', rel: 'noopener noreferrer' }
