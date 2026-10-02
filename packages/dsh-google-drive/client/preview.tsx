import * as React from 'react'
import type {
  PreviewStatus,
  PreviewCell,
  PreviewDialogProps,
  PreviewCardProps,
  PreviewAction,
} from './contracts.js'
import { isRecord, errorName, errorMessage } from './contracts.js'
import { api } from './rpc.js'
import { css, previewCSS } from './styles.js'
import { icon, iconButton, button } from './controls.js'
export const previewStates = [
  'preparing',
  'pending',
  'applying',
  'applied',
  'denied',
  'cancelled',
  'expired',
  'stale',
  'failed',
  'uncertain',
]

export function validPreviewStatus(value: unknown): value is PreviewStatus {
  if (
    !isRecord(value) ||
    typeof value.state !== 'string' ||
    !previewStates.includes(value.state) ||
    typeof value.requestId !== 'string'
  )
    return false
  if (value.state !== 'pending' && !value.preview) return true
  const p = value.preview
  if (
    !isRecord(p) ||
    typeof p.fileId !== 'string' ||
    typeof p.range !== 'string' ||
    !isRecord(p.tab) ||
    typeof p.tab.title !== 'string'
  )
    return false
  function validCells(snapshot: unknown): snapshot is { cells: PreviewCell[] } {
    if (!isRecord(snapshot) || !Array.isArray(snapshot.cells) || snapshot.cells.length > 200)
      return false
    const cells: unknown[] = snapshot.cells
    if (
      !cells.every(
        (c): c is PreviewCell =>
          isRecord(c) && typeof c.cell === 'string' && /^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(c.cell),
      )
    )
      return false
    return (
      new Set(cells.map((c) => c.cell)).size === cells.length &&
      new Set(cells.map((c) => c.cell.match(/^[A-Z]+/)![0])).size <= 20 &&
      new Set(cells.map((c) => c.cell.match(/[0-9]+$/)![0])).size <= 100
    )
  }
  const before = p.before,
    after = p.after
  return (
    validCells(before) &&
    validCells(after) &&
    before.cells.length === after.cells.length &&
    before.cells.every((c, i) => c.cell === after.cells[i]!.cell)
  )
}

export const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function cellText(cell: PreviewCell) {
  const value = record(cell.userEnteredValue)
  if (typeof value?.formulaValue === 'string') return value.formulaValue
  if (typeof value?.stringValue === 'string') return value.stringValue
  if (typeof value?.numberValue === 'number') return String(value.numberValue)
  if (typeof value?.boolValue === 'boolean') return value.boolValue ? 'TRUE' : 'FALSE'
  return ''
}

export function exactValue(cell: PreviewCell) {
  const value = record(cell.userEnteredValue)
  if (value == null) return { type: 'Empty cell', text: '(no value)' }
  if (typeof value.stringValue === 'string')
    return {
      type: value.stringValue === '' ? 'Empty string' : 'Text',
      text: JSON.stringify(value.stringValue),
    }
  if (typeof value.numberValue === 'number')
    return { type: 'Number', text: String(value.numberValue) }
  if (typeof value.boolValue === 'boolean')
    return { type: 'Boolean', text: value.boolValue ? 'TRUE' : 'FALSE' }
  if (typeof value.formulaValue === 'string')
    return { type: 'Formula · result not predicted', text: JSON.stringify(value.formulaValue) }
  return { type: 'Empty cell', text: '(no value)' }
}

export function colorCSS(value: unknown) {
  if (!isRecord(value)) return undefined
  const channels = ['red', 'green', 'blue'].map((key) => value[key] ?? 0)
  if (
    !channels.every(
      (n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1,
    )
  )
    return undefined
  return `rgb(${channels.map((n) => Math.round(n * 255)).join(', ')})`
}

const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})
export function cellStyle(value: unknown = {}): React.CSSProperties {
  const format = record(value),
    text = record(format.textFormat)
  const style: React.CSSProperties = {}
  const bg = colorCSS(record(format.backgroundColorStyle).rgbColor || format.backgroundColor),
    fg = colorCSS(record(text.foregroundColorStyle).rgbColor || text.foregroundColor)
  if (text.underline || text.strikethrough)
    style.textDecoration = [text.underline && 'underline', text.strikethrough && 'line-through']
      .filter(Boolean)
      .join(' ')
  // Keep every value readable even when the proposed wrap strategy clips text.
  if (bg) style.backgroundColor = bg
  if (fg) style.color = fg
  if (typeof text.bold === 'boolean') style.fontWeight = text.bold ? 'bold' : 'normal'
  if (typeof text.italic === 'boolean') style.fontStyle = text.italic ? 'italic' : 'normal'
  if (
    typeof text.fontSize === 'number' &&
    Number.isFinite(text.fontSize) &&
    text.fontSize >= 6 &&
    text.fontSize <= 72
  )
    style.fontSize = `${text.fontSize}pt`
  if (typeof text.fontFamily === 'string' && /^[a-zA-Z0-9 -]{1,80}$/.test(text.fontFamily))
    style.fontFamily = text.fontFamily
  if (
    format.horizontalAlignment === 'LEFT' ||
    format.horizontalAlignment === 'CENTER' ||
    format.horizontalAlignment === 'RIGHT'
  )
    style.textAlign = format.horizontalAlignment.toLowerCase() as 'left' | 'center' | 'right'
  if (
    format.verticalAlignment === 'TOP' ||
    format.verticalAlignment === 'MIDDLE' ||
    format.verticalAlignment === 'BOTTOM'
  )
    style.verticalAlign = format.verticalAlignment.toLowerCase()
  const borderStyles: Record<string, string> = {
    SOLID: '1px solid',
    SOLID_MEDIUM: '2px solid',
    SOLID_THICK: '3px solid',
    DOTTED: '1px dotted',
    DASHED: '1px dashed',
    DOUBLE: '3px double',
    NONE: '0 solid',
  }
  const sides = {
    top: 'borderTop',
    bottom: 'borderBottom',
    left: 'borderLeft',
    right: 'borderRight',
  } as const
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const border = record(record(format.borders)[side])
    if (typeof border.style === 'string' && borderStyles[border.style])
      style[sides[side]] =
        `${borderStyles[border.style]} ${colorCSS(record(border.colorStyle).rgbColor || border.color) || '#202124'}`
  }
  return style
}

export function formatFields(value: unknown, prefix = '', depth = 0): [string, string][] {
  if (depth > 5 || !value || typeof value !== 'object') return []
  if (prefix && Object.keys(value).length === 0)
    return [
      [prefix, /(?:Color|rgbColor)$/.test(prefix) ? '{} (RGB default black)' : '{} (empty object)'],
    ]
  return Object.entries(value).flatMap<[string, string]>(([key, item]) => {
    const name = prefix ? `${prefix}.${key}` : key
    if (item && typeof item === 'object' && !Array.isArray(item))
      return formatFields(item, name, depth + 1)
    return [[name, String(item)]]
  })
}

export function formatLabel(path: string) {
  return path
    .split('.')
    .map((part) => part.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()))
    .join(' › ')
}

export function FormatDiff({ before, after }: { before: unknown; after: unknown }) {
  const a = new Map(formatFields(before)),
    b = new Map(formatFields(after))
  return (
    <dl className={'gs-fields'}>
      {[...new Set([...a.keys(), ...b.keys()])]
        .filter((key) => a.get(key) !== b.get(key))
        .map((key) => (
          <React.Fragment key={key}>
            {<dt>{formatLabel(key)}</dt>}
            {<dd>{`${a.get(key) ?? 'Default / unset'} → ${b.get(key) ?? 'Default / unset'}`}</dd>}
          </React.Fragment>
        ))}
    </dl>
  )
}

export function Grid({
  label,
  cells,
  changed,
}: {
  label: string
  cells: PreviewCell[]
  changed: Set<string>
}) {
  const columns = [...new Set(cells.map((c) => c.cell.match(/^[A-Z]+/)![0]))]
  const rows = [...new Set(cells.map((c) => c.cell.match(/[0-9]+$/)![0]))]
  const lookup = new Map(cells.map((c) => [c.cell, c]))
  return (
    <section className={'gs-grid'} aria-label={label}>
      {<h3>{label}</h3>}
      {
        <div
          className={'gs-table-scroll'}
          tabIndex={0}
          role={'region'}
          aria-label={`${label} grid, scroll to review all columns`}
        >
          {
            <table>
              {
                <thead>
                  {
                    <tr>
                      {<th />}
                      {columns.map((col) => (
                        <th key={col} scope={'col'}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  }
                </thead>
              }
              {
                <tbody>
                  {rows.map((row) => (
                    <tr key={row}>
                      {<th scope={'row'}>{row}</th>}
                      {columns.map((col) => {
                        const cell = lookup.get(`${col}${row}`)
                        return (
                          <td
                            key={col}
                            style={cellStyle(cell?.userEnteredFormat)}
                            data-changed={changed.has(`${col}${row}`)}
                          >
                            {cell ? cellText(cell) : ''}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              }
            </table>
          }
        </div>
      }
    </section>
  )
}

export function PreviewDialog({ status, busy, error, act, close }: PreviewDialogProps) {
  const dialog = React.useRef<HTMLDialogElement | null>(null)
  React.useEffect(() => {
    const previous = document.activeElement
    dialog.current!.showModal()
    return () => {
      dialog.current?.close()
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])
  const p = status.preview
  const changes = p.before.cells
    .map((before, i) => ({ before, after: p.after.cells[i]! }))
    .filter(
      ({ before, after }) =>
        !same(before.userEnteredValue, after.userEnteredValue) ||
        !same(before.userEnteredFormat, after.userEnteredFormat),
    )
  const changed = new Set(changes.map((c) => c.before.cell))
  const cleared = changes.filter(
    (c) => c.before.userEnteredValue != null && c.after.userEnteredValue == null,
  ).length
  const formulas = changes.filter(
    (c) =>
      !same(c.before.userEnteredValue, c.after.userEnteredValue) &&
      typeof record(c.after.userEnteredValue).formulaValue === 'string',
  ).length
  const formats = changes.filter(
    (c) => !same(c.before.userEnteredFormat, c.after.userEnteredFormat),
  ).length
  return (
    <dialog
      ref={dialog}
      className={'gd-access gd-modal gs-preview'}
      aria-label={'Review spreadsheet changes'}
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) close()
      }}
    >
      {<style>{css + previewCSS}</style>}
      {
        <header className={'gd-header'}>
          {<span className={'gd-drive-mark'}>{icon('spreadsheet')}</span>}
          {
            <div className={'gd-header-copy'}>
              {<h2>{'Review spreadsheet changes'}</h2>}
              {
                <p>{`${typeof p.fileName === 'string' ? p.fileName : 'Spreadsheet'} · ${p.tab.title} · ${p.range}`}</p>
              }
            </div>
          }
          {iconButton('Close preview', 'close', close, busy)}
        </header>
      }
      {
        <div className={'gs-body'}>
          {<p className={'gd-muted'}>{`Spreadsheet ID: ${p.fileId}`}</p>}
          {
            <p>{`${changes.length} changed cells · ${cleared} cleared · ${formulas} new or changed formulas · ${formats} formatting changes`}</p>
          }
          {
            <p className={'gd-muted'}>
              {
                'Approximate local preview. Raw values and formula text are shown, not calculated results or formatted number displays. Fonts, wrapping, themes, conditional formatting and rich text may differ in Google Sheets. Exact changes below are authoritative.'
              }
            </p>
          }
          {
            <p className={'gd-muted'}>
              {
                'DSH checks for changes before applying, but another editor can still change the spreadsheet between that check and the write.'
              }
            </p>
          }
          {
            <div className={'gs-grids'}>
              {<Grid label={'Before'} cells={p.before.cells} changed={changed} />}
              {<Grid label={'After'} cells={p.after.cells} changed={changed} />}
            </div>
          }
          {<h3>{'Exact changes'}</h3>}
          {
            <p className={'gd-muted'}>
              {
                'Text and formulas use quoted JSON notation: spaces are preserved and control characters are escaped. Types distinguish text, numbers, booleans and empty cells.'
              }
            </p>
          }
          {changes.map(({ before, after }) => (
            <section
              className={'gs-detail'}
              key={before.cell}
              aria-label={`Changes to ${before.cell}`}
            >
              {<strong>{before.cell}</strong>}
              {!same(before.userEnteredValue, after.userEnteredValue) && (
                <div className={'gs-pair'}>
                  {[before, after].map((cell, i) => (
                    <div key={i}>
                      {<p>{i ? 'After' : 'Before'}</p>}
                      {<div className={'gs-value'}>{exactValue(cell).text}</div>}
                      {
                        <p
                          className={'gd-muted'}
                        >{`${exactValue(cell).type}${i && before.userEnteredValue != null && cell.userEnteredValue == null ? ' · Clear cell value' : ''}`}</p>
                      }
                    </div>
                  ))}
                </div>
              )}
              {<FormatDiff before={before.userEnteredFormat} after={after.userEnteredFormat} />}
            </section>
          ))}
          {error && <p role={'alert'}>{error}</p>}
          {<p role={'status'}>{`Status: ${status.state}`}</p>}
        </div>
      }
      {
        <footer className={'gd-footer'}>
          {
            <div className={'gd-footer-count'}>
              {'Only this exact proposal'}
              {<p>{'No Google writes until you apply.'}</p>}
            </div>
          }
          {
            <div className={'gd-footer-actions'}>
              {status.state === 'pending' ? (
                <React.Fragment>
                  {button('Cancel proposal', () => act('preview-deny'), busy)}
                  {
                    <button
                      type={'button'}
                      className={'gd-primary'}
                      disabled={busy}
                      onClick={() => act('preview-apply')}
                    >
                      {'Apply changes'}
                    </button>
                  }
                </React.Fragment>
              ) : (
                button('Close', close, busy)
              )}
            </div>
          }
        </footer>
      }
    </dialog>
  )
}

export function PreviewCard({ sessionId, callId, request = api }: PreviewCardProps) {
  const [status, setStatus] = React.useState<PreviewStatus | null>(null),
    [error, setError] = React.useState(''),
    [open, setOpen] = React.useState(false),
    [busy, setBusy] = React.useState(false)
  const [revision, refresh] = React.useReducer((n) => n + 1, 0)
  const generation = React.useRef(0),
    acting = React.useRef(false),
    mutation = React.useRef<AbortController | null>(null)
  React.useEffect(() => {
    const token = ++generation.current,
      controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined,
      failures = 0
    setStatus(null)
    setOpen(false)
    setError('')
    setBusy(false)
    acting.current = false
    async function load() {
      if (generation.current !== token) return
      try {
        const value = await request('preview-status', { sessionId, callId }, controller.signal)
        if (generation.current !== token) return
        if (!validPreviewStatus(value))
          throw new Error('Invalid spreadsheet preview. Approval is unavailable.')
        setStatus(value)
        setError('')
        failures = 0
        if (['preparing', 'pending', 'applying'].includes(value.state))
          timer = setTimeout(load, 1500)
      } catch (err) {
        if (generation.current !== token || errorName(err) === 'AbortError') return
        setError(errorMessage(err))
        if (++failures <= 10) timer = setTimeout(load, 1500)
      }
    }
    void load()
    return () => {
      generation.current++
      controller.abort()
      mutation.current?.abort()
      clearTimeout(timer)
    }
  }, [sessionId, callId, request, revision])
  async function act(method: PreviewAction) {
    if (
      acting.current ||
      (status?.state !== 'pending' && !(method === 'preview-deny' && status?.state === 'preparing'))
    )
      return
    acting.current = true
    setBusy(true)
    setError('')
    const token = ++generation.current
    mutation.current = new AbortController()
    try {
      const value = await request(
        method,
        { sessionId, callId, requestId: status.requestId },
        mutation.current.signal,
      )
      if (generation.current !== token) return
      if (!validPreviewStatus(value)) throw new Error('Invalid write response.')
      setStatus(value)
    } catch (err) {
      if (generation.current !== token) return
      // A lost response must never re-enable Apply; only an authoritative new proposal can do that.
      setStatus((previous) =>
        previous
          ? { ...previous, state: method === 'preview-apply' ? 'uncertain' : 'cancelled' }
          : previous,
      )
      setError(
        method === 'preview-apply'
          ? 'Write outcome is unknown. Do not retry this proposal. Inspect the spreadsheet before proposing another change.'
          : 'Cancellation could not be confirmed. No write was requested by this action.',
      )
    } finally {
      if (generation.current === token) {
        acting.current = false
        setBusy(false)
      }
    }
  }
  async function checkOutcome() {
    if (!status || acting.current) return
    acting.current = true
    setBusy(true)
    const token = ++generation.current
    mutation.current = new AbortController()
    try {
      const value = await request('preview-status', { sessionId, callId }, mutation.current.signal)
      if (generation.current !== token) return
      if (!validPreviewStatus(value) || value.requestId !== status.requestId)
        throw new Error('Cannot confirm this proposal outcome.')
      if (!['preparing', 'pending', 'applying'].includes(value.state)) {
        setStatus(value)
        setError('')
      } else
        setError(
          'The outcome is not confirmed yet. Check status again later; do not resubmit the write.',
        )
    } catch {
      if (generation.current === token)
        setError('Cannot confirm the outcome. Check status again later; do not resubmit the write.')
    } finally {
      if (generation.current === token) {
        acting.current = false
        setBusy(false)
      }
    }
  }
  return (
    <section className={'gd-access gd-card'} aria-label={'Google Sheets edit proposal'}>
      {<style>{css}</style>}
      {
        <div className={'gd-card-title'}>
          {icon('spreadsheet')}
          {<strong>{'Google Sheets · Proposed changes'}</strong>}
        </div>
      }
      {<p role={'status'}>{status ? `Status: ${status.state}` : 'Preparing preview…'}</p>}
      {status?.state === 'uncertain' && (
        <p role={'alert'}>
          {
            'The write outcome is uncertain. Do not retry. Inspect the spreadsheet before proposing another change.'
          }
        </p>
      )}
      {typeof record(status?.result).message === 'string' && (
        <p>{String(record(status?.result).message)}</p>
      )}
      {error && <p role={'alert'}>{error}</p>}
      {status?.preview && (
        <div className={'gd-actions'}>
          {button(
            status.state === 'pending' ? 'Review changes' : 'View proposal',
            () => setOpen(true),
            busy,
          )}
        </div>
      )}
      {status?.state === 'preparing' && button('Cancel proposal', () => act('preview-deny'), busy)}
      {status?.state === 'uncertain' && button('Check outcome status', checkOutcome, busy)}
      {!status && error && button('Refresh status', () => refresh())}
      {open && status?.preview && (
        <PreviewDialog
          status={{ ...status, preview: status.preview }}
          busy={busy}
          error={error}
          act={act}
          close={() => setOpen(false)}
        />
      )}
    </section>
  )
}
