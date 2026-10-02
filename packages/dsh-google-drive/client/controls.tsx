import * as React from 'react'
import { FOLDER } from './contracts.js'
export function icon(name: string) {
  const paths: Record<string, string> = {
    drive: 'M8 3h8l6 11-4 7H6l-4-7 6-11Zm0 0 10 18M16 3 6 21M2 14h20',
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
    close: 'm6 6 12 12M18 6 6 18',
    chevron: 'm9 5 7 7-7 7',
    down: 'm5 9 7 7 7-7',
    folder: 'M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z',
    document: 'M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8M8 16h8',
    spreadsheet: 'M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8v6H8v-6Zm4 0v6M8 15h8',
    presentation: 'M3 4h18v13H3V4Zm9 13v4m-4 0 4-4 4 4M7 8h10M7 12h6',
    image: 'M3 3h18v18H3V3Zm0 14 6-6 5 5 3-3 4 4M16 7h.01',
    pdf: 'M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 13h8M8 17h5',
    file: 'M14 2H5v20h14V7l-5-5Zm0 0v6h5',
  }
  return (
    <svg
      className={'gd-icon'}
      viewBox={'0 0 24 24'}
      fill={'none'}
      stroke={'currentColor'}
      strokeWidth={1.6}
      strokeLinecap={'round'}
      strokeLinejoin={'round'}
      aria-hidden={true}
      focusable={false}
    >
      {<path d={paths[name] || paths.file} />}
    </svg>
  )
}

export function fileType(item: { mimeType?: string; recursive?: boolean }): [string, string] {
  const mime = item.mimeType || ''
  if (mime === FOLDER || item.recursive) return ['folder', 'Folder']
  if (mime.includes('spreadsheet') || mime.includes('excel')) return ['spreadsheet', 'Spreadsheet']
  if (mime.includes('presentation') || mime.includes('powerpoint'))
    return ['presentation', 'Slides']
  if (mime.startsWith('image/')) return ['image', 'Image']
  if (mime === 'application/pdf') return ['pdf', 'PDF']
  if (mime.includes('document') || mime.startsWith('text/')) return ['document', 'Document']
  return ['file', 'File']
}

export function fileIcon(item: { mimeType?: string; recursive?: boolean }) {
  const [kind] = fileType(item)
  return (
    <span className={'gd-file-icon'} data-kind={kind}>
      {icon(kind)}
    </span>
  )
}

export function iconButton(label: string, name: string, onClick: () => void, disabled = false) {
  return (
    <button
      type={'button'}
      className={'gd-icon-button'}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {icon(name)}
    </button>
  )
}

export const button = (label: string, onClick: () => void, disabled = false) => (
  <button type={'button'} onClick={onClick} disabled={disabled}>
    {label}
  </button>
)
