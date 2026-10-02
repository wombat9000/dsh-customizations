import type { ClientOptions } from './types.js'
import { errorField, isRecord } from './types.js'
import type {
  FormatObject,
  SheetValue,
  Tab,
  Cell,
  Snapshot,
  CellUpdate,
  UpdateRequest,
  Proposal,
  DescribeOptions,
  ReadOptions,
  PrepareOptions,
  ApplyOptions,
  ApplyResult,
  Point,
  Range,
} from './sheets-types.js'
type Rule = ((value: unknown) => string | number | boolean) & { jsonSchema?: object }
interface FormatSchema {
  [key: string]: Rule | FormatSchema
}
interface ValidatedChange {
  cell: string
  p: Point
  value?: SheetValue | null
  format?: FormatObject
}
import { SheetsTransport, sheetsError } from './sheets-transport.js'

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
export const SHEETS_MIME = 'application/vnd.google-apps.spreadsheet'
function fail(): never {
  throw sheetsError('invalid', 'Invalid or unsupported bounded Google Sheets input.')
}
const own = (o: object, k: PropertyKey) => Object.hasOwn(o, k)
function object(o: unknown): asserts o is Record<string, unknown> {
  if (!o || typeof o !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(o)))
    fail()
}
function keys<T>(o: T, allowed: string[]): asserts o is T & Record<string, unknown> {
  object(o)
  for (const k of Reflect.ownKeys(o)) {
    if (
      typeof k !== 'string' ||
      !allowed.includes(k) ||
      !own(Object.getOwnPropertyDescriptor(o, k)!, 'value')
    )
      fail()
  }
}
const text = (v: unknown, max = 10_000) => {
  if (typeof v !== 'string' || v.length > max) fail()
  return v
}
const integer = (v: unknown, min: number, max: number) => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) fail()
  return v
}
const enumeration = (values: string[]) =>
  Object.assign(
    (v: unknown) => {
      if (typeof v !== 'string' || !values.includes(v)) fail()
      return v
    },
    { jsonSchema: { type: 'string', enum: values } },
  )
const boolean = (v: unknown) => {
  if (typeof v !== 'boolean') fail()
  return v
}
const number = (v: unknown) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail()
  return v
}
const color = { red: number, green: number, blue: number, alpha: number }
const colorStyle = {
  rgbColor: color,
  themeColor: enumeration([
    'TEXT',
    'BACKGROUND',
    'ACCENT1',
    'ACCENT2',
    'ACCENT3',
    'ACCENT4',
    'ACCENT5',
    'ACCENT6',
    'LINK',
  ]),
}
const border = {
  style: enumeration([
    'NONE',
    'DOTTED',
    'DASHED',
    'SOLID',
    'SOLID_MEDIUM',
    'SOLID_THICK',
    'DOUBLE',
  ]),
  color,
  colorStyle,
}
const formatSchema = {
  backgroundColor: color,
  backgroundColorStyle: colorStyle,
  textFormat: {
    fontFamily: (v: unknown) => text(v, 100),
    fontSize: (v: unknown) => integer(v, 1, 400),
    bold: boolean,
    italic: boolean,
    strikethrough: boolean,
    underline: boolean,
    foregroundColor: color,
    foregroundColorStyle: colorStyle,
  },
  borders: { top: border, bottom: border, left: border, right: border },
  horizontalAlignment: enumeration(['LEFT', 'CENTER', 'RIGHT']),
  verticalAlignment: enumeration(['TOP', 'MIDDLE', 'BOTTOM']),
  wrapStrategy: enumeration(['OVERFLOW_CELL', 'LEGACY_WRAP', 'CLIP', 'WRAP']),
  numberFormat: {
    type: enumeration([
      'TEXT',
      'NUMBER',
      'PERCENT',
      'CURRENCY',
      'DATE',
      'TIME',
      'DATE_TIME',
      'SCIENTIFIC',
    ]),
    pattern: (v: unknown) => text(v, 256),
  },
}
const atomicSchemas = new Set<FormatSchema>([color, colorStyle, formatSchema.numberFormat])
const atomicFields = new Set([
  'backgroundColor',
  'foregroundColor',
  'color',
  'rgbColor',
  'backgroundColorStyle',
  'foregroundColorStyle',
  'colorStyle',
  'numberFormat',
])
function schemaOf(schema: FormatSchema): object {
  return {
    type: 'object',
    additionalProperties: false,
    ...(schema === formatSchema.numberFormat ? { required: ['type'] } : {}),
    ...(schema === colorStyle
      ? {
          oneOf: [
            { required: ['rgbColor'], not: { required: ['themeColor'] } },
            { required: ['themeColor'], not: { required: ['rgbColor'] } },
          ],
        }
      : {}),
    properties: Object.fromEntries(
      Object.entries(schema).map(([k, rule]) => {
        const leaf =
          typeof rule === 'object'
            ? schemaOf(rule)
            : ((rule as Rule).jsonSchema ??
              (rule === boolean
                ? { type: 'boolean' }
                : rule === number
                  ? { type: 'number', minimum: 0, maximum: 1 }
                  : k === 'fontSize'
                    ? { type: 'integer', minimum: 1, maximum: 400 }
                    : { type: 'string', maxLength: k === 'pattern' ? 256 : 100 }))
        return [
          k,
          (schema === formatSchema.numberFormat && k === 'type') || schema === colorStyle
            ? leaf
            : { anyOf: [leaf, { type: 'null' }] },
        ]
      }),
    ),
  }
}
export const SHEETS_CHANGE_SCHEMA = freeze({
  type: 'object',
  additionalProperties: false,
  required: ['cell'],
  properties: {
    cell: { type: 'string', pattern: '^[A-Z]{1,3}[1-9][0-9]{0,6}$' },
    value: {
      anyOf: [
        { type: 'string', maxLength: 10000 },
        { type: 'number' },
        { type: 'boolean' },
        { type: 'null' },
      ],
    },
    formula: { type: 'string', pattern: '^=', minLength: 2, maxLength: 10000 },
    format: { anyOf: [schemaOf(formatSchema), { type: 'null' }] },
  },
  anyOf: [{ required: ['value'] }, { required: ['formula'] }, { required: ['format'] }],
  not: { required: ['value', 'formula'] },
})
// Preserve unsupported format fields with leaf masks, except fully supported
// atomic color/number-format objects. A union must never be recursively merged.
function clearFormat(schema: FormatSchema): FormatObject {
  return Object.fromEntries(
    Object.entries(schema).map(([k, rule]) => [
      k,
      typeof rule === 'object' && !atomicSchemas.has(rule) ? clearFormat(rule) : null,
    ]),
  )
}
function format(v: unknown, schema: FormatSchema = formatSchema, strict = true): FormatObject {
  object(v)
  if (strict) keys(v, Object.keys(schema))
  const out: FormatObject = {}
  for (const k of Object.keys(schema))
    if (own(v, k)) {
      const value = v[k],
        rule = schema[k]!
      if (value === null && strict)
        out[k] = typeof rule === 'object' && !atomicSchemas.has(rule) ? clearFormat(rule) : null
      else out[k] = typeof rule === 'function' ? rule(value) : format(value, rule, strict)
    }
  if (schema === color)
    for (const v of Object.values(out))
      if (v !== null && (typeof v !== 'number' || v < 0 || v > 1)) fail()
  if (schema === colorStyle) {
    if (Object.keys(out).length !== 1 || Object.values(out).some((v) => v === null)) fail()
    // Sheets does not generally support alpha on ColorStyle.
    const alpha = isRecord(out.rgbColor) ? out.rgbColor.alpha : undefined
    if (strict && alpha !== undefined && alpha !== null && alpha !== 1) fail()
  }
  if (strict && schema === formatSchema.numberFormat && (!own(out, 'type') || out.type === null))
    fail()
  // Null components in an atomic object mean absent/default on replacement.
  if (strict && atomicSchemas.has(schema))
    for (const k of Object.keys(out)) if (out[k] === null) delete out[k]
  return out
}
function freeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) freeze(v)
    Object.freeze(o)
  }
  return o
}
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o))
function point(v: unknown) {
  if (typeof v !== 'string' || !/^[A-Z]{1,3}[1-9][0-9]{0,6}$/u.test(v)) fail()
  const [, letters, digits] = /^([A-Z]+)([0-9]+)$/u.exec(v)!
  let col = 0
  for (const c of letters!) col = col * 26 + c.charCodeAt(0) - 64
  return { col: integer(col, 1, 18_278) - 1, row: integer(Number(digits), 1, 10_000_000) - 1 }
}
function rangeOf(value: unknown): Range {
  value = text(value, 300)
  const m =
    /^(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_ ]*))!([A-Z]{1,3}[1-9][0-9]{0,6})(?::([A-Z]{1,3}[1-9][0-9]{0,6}))?$/u.exec(
      value as string,
    )
  if (!m) fail()
  const title = m[1]?.replaceAll("''", "'") ?? m[2]!
  text(title, 100)
  if (/[\x00-\x1f\x7f]/u.test(title)) fail()
  const start = point(m[3]),
    end = point(m[4] ?? m[3])
  const rows = end.row - start.row + 1,
    cols = end.col - start.col + 1
  if (rows < 1 || cols < 1 || rows > 100 || cols > 20 || rows * cols > 200) fail()
  return {
    title,
    start,
    end,
    rows,
    cols,
    range: `'${title.replaceAll("'", "''")}'!${m[3]}:${m[4] ?? m[3]}`,
  }
}
function address(col: number, row: number) {
  let s = ''
  for (let n = col + 1; n; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s + (row + 1)
}
function file(v: unknown) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/u.test(v)) fail()
  return v
}
function url(fileId: unknown, params: Record<string, string>, write = false) {
  const u = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${file(fileId)}${write ? ':batchUpdate' : ''}`,
  )
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.href
}
const properties = 'sheetId,title,index,sheetType,gridProperties(rowCount,columnCount)'
function tabOf(p: unknown): Tab {
  object(p)
  if (p.sheetType !== undefined && p.sheetType !== 'GRID') fail()
  object(p.gridProperties)
  return {
    sheetId: integer(p.sheetId, 0, 2_147_483_647),
    title: text(p.title, 100),
    rowCount: integer(p.gridProperties?.rowCount, 1, 10_000_000),
    columnCount: integer(p.gridProperties?.columnCount, 1, 18_278),
  }
}
function valueOf(v: unknown, effective = false): SheetValue | null {
  if (v === undefined || v === null) return null
  keys(v, [
    'stringValue',
    'numberValue',
    'boolValue',
    'formulaValue',
    ...(effective ? ['errorValue'] : []),
  ])
  const ks = Object.keys(v)
  if (!ks.length) return null
  if (ks.length !== 1) fail()
  const k = ks[0]!
  if (k === 'errorValue') {
    const error = v[k]
    keys(error, ['type', 'message'])
    return { errorValue: { type: text(error.type, 100), message: text(error.message ?? '', 1000) } }
  }
  return {
    [k]: k === 'numberValue' ? number(v[k]) : k === 'boolValue' ? boolean(v[k]) : text(v[k]),
  }
}
function hasRuns(value: unknown) {
  if (value === undefined) return false
  if (!Array.isArray(value) || value.length > 10_001) fail()
  // Read only presence metadata, never rich-text links or smart-chip identities.
  for (const run of value as unknown[]) {
    keys(run, ['startIndex'])
    if (run.startIndex !== undefined) integer(run.startIndex, 0, 10_000)
  }
  return value.length > 0
}
function normalize(raw: unknown, fileId: string, r: Range): Snapshot {
  object(raw)
  if (!Array.isArray(raw.sheets) || raw.sheets.length !== 1) fail()
  const sheet: unknown = raw.sheets[0]
  object(sheet)
  const tab = tabOf(sheet.properties)
  if (tab.title !== r.title || r.end.row >= tab.rowCount || r.end.col >= tab.columnCount) fail()
  const cells: Cell[] = []
  for (let row = r.start.row; row <= r.end.row; row++)
    for (let col = r.start.col; col <= r.end.col; col++)
      cells.push({
        cell: address(col, row),
        userEnteredValue: null,
        effectiveValue: null,
        formattedValue: '',
        userEnteredFormat: {},
      })
  const seen = new Set()
  if (sheet.data !== undefined && (!Array.isArray(sheet.data) || sheet.data.length > 1)) fail()
  for (const grid of (sheet.data ?? []) as unknown[]) {
    object(grid)
    const sr = integer(grid.startRow ?? 0, r.start.row, r.end.row),
      sc = integer(grid.startColumn ?? 0, r.start.col, r.end.col)
    if (
      grid.rowData !== undefined &&
      (!Array.isArray(grid.rowData) || grid.rowData.length > r.rows)
    )
      fail()
    for (const [i, row] of ((grid.rowData ?? []) as unknown[]).entries()) {
      object(row)
      if (row.values !== undefined && (!Array.isArray(row.values) || row.values.length > r.cols))
        fail()
      for (const [j, rawCell] of ((row.values ?? []) as unknown[]).entries()) {
        const rr = sr + i,
          cc = sc + j
        if (rr > r.end.row || cc > r.end.col) fail()
        const index = (rr - r.start.row) * r.cols + cc - r.start.col
        if (seen.has(index)) fail()
        seen.add(index)
        object(rawCell)
        cells[index] = {
          cell: address(cc, rr),
          userEnteredValue: valueOf(rawCell.userEnteredValue),
          effectiveValue: valueOf(rawCell.effectiveValue, true),
          formattedValue: text(rawCell.formattedValue ?? ''),
          userEnteredFormat: format(rawCell.userEnteredFormat ?? {}, formatSchema, false),
          ...(hasRuns(rawCell.textFormatRuns) ? { hasRichText: true } : {}),
          ...(hasRuns(rawCell.chipRuns) ? { hasSmartChips: true } : {}),
        }
      }
    }
  }
  if (sheet.merges !== undefined && (!Array.isArray(sheet.merges) || sheet.merges.length > 10_000))
    fail()
  for (const merge of (sheet.merges ?? []) as unknown[]) {
    keys(merge, ['sheetId', 'startRowIndex', 'endRowIndex', 'startColumnIndex', 'endColumnIndex'])
    if (merge.sheetId !== undefined && merge.sheetId !== tab.sheetId) fail()
    const sr = integer(merge.startRowIndex ?? 0, 0, tab.rowCount - 1),
      er = integer(merge.endRowIndex, sr + 1, tab.rowCount)
    const sc = integer(merge.startColumnIndex ?? 0, 0, tab.columnCount - 1),
      ec = integer(merge.endColumnIndex, sc + 1, tab.columnCount)
    for (let row = Math.max(sr, r.start.row); row < Math.min(er, r.end.row + 1); row++)
      for (let col = Math.max(sc, r.start.col); col < Math.min(ec, r.end.col + 1); col++)
        cells[(row - r.start.row) * r.cols + col - r.start.col]!.isMerged = true
  }
  return { fileId, range: r.range, tab, cells }
}
function patch(target: FormatObject, input: FormatObject, prefix: string, masks: string[]) {
  for (const [k, v] of Object.entries(input)) {
    const path = `${prefix}.${k}`
    if (v === null) {
      delete target[k]
      masks.push(path)
    } else if (typeof v === 'object' && atomicFields.has(k)) {
      target[k] = clone(v)
      masks.push(path)
    } else if (typeof v === 'object') {
      target[k] ??= {}
      patch(target[k] as FormatObject, v, path, masks)
      if (!Object.keys(target[k] as FormatObject).length) delete target[k]
    } else {
      target[k] = v
      masks.push(path)
    }
  }
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function changedFormat(current: FormatObject, input: FormatObject): FormatObject {
  const out: FormatObject = {}
  for (const [k, v] of Object.entries(input)) {
    if (v === null) {
      if (own(current, k)) out[k] = null
    } else if (typeof v !== 'object' || atomicFields.has(k)) {
      if (!equal(current[k], v)) out[k] = v
    } else {
      const nested = changedFormat((current[k] ?? {}) as FormatObject, v)
      if (Object.keys(nested).length) out[k] = nested
    }
  }
  return out
}
const comparison = (snapshot: Snapshot) =>
  JSON.stringify({
    tab: snapshot.tab,
    cells: snapshot.cells.map((c) => ({
      cell: c.cell,
      userEnteredValue: c.userEnteredValue,
      userEnteredFormat: c.userEnteredFormat,
      hasRichText: c.hasRichText === true,
      hasSmartChips: c.hasSmartChips === true,
      isMerged: c.isMerged === true,
      isCalculatedOutput: c.userEnteredValue === null && c.effectiveValue !== null,
    })),
  })

export class GoogleSheetsClient {
  #transport
  #proposals = new WeakSet<Proposal>()
  constructor(options: ClientOptions) {
    this.#transport = new SheetsTransport(options)
  }
  dispose() {
    this.#transport.dispose()
    this.#proposals = new WeakSet<Proposal>()
  }
  async describe(options: DescribeOptions) {
    keys(options, ['fileId', 'signal'])
    const { fileId, signal } = options
    const raw = await this.#transport.request(
      url(fileId, { fields: `properties(title),sheets(properties(${properties}))` }),
      { signal },
    )
    object(raw)
    if (!Array.isArray(raw.sheets)) fail()
    return freeze({
      fileId: file(fileId),
      title: text(isRecord(raw.properties) ? (raw.properties.title ?? '') : '', 1000),
      tabs: (raw.sheets as unknown[])
        .slice(0, 100)
        .filter((s) => {
          object(s)
          return (
            !isRecord(s.properties) || !s.properties.sheetType || s.properties.sheetType === 'GRID'
          )
        })
        .map((s) => {
          object(s)
          const tab = tabOf(s.properties)
          object(s.properties)
          return { ...tab, index: integer(s.properties.index ?? 0, 0, 10000) }
        }),
      truncated: raw.sheets.length > 100,
    })
  }
  async read(options: ReadOptions) {
    keys(options, ['fileId', 'range', 'signal'])
    const { fileId, range, signal } = options
    const r = rangeOf(range)
    const raw = await this.#transport.request(
      url(fileId, {
        ranges: r.range,
        fields: `sheets(properties(${properties}),merges,data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,formattedValue,userEnteredFormat,textFormatRuns(startIndex),chipRuns(startIndex)))))`,
      }),
      { signal },
    )
    return freeze(normalize(raw, file(fileId), r))
  }
  async prepare(options: PrepareOptions) {
    keys(options, ['fileId', 'range', 'changes', 'signal'])
    const { fileId, range, changes, signal } = options
    file(fileId)
    const r = rangeOf(range)
    if (!Array.isArray(changes) || changes.length < 1 || changes.length > 200) fail()
    const seen = new Set()
    const validated = (changes as unknown[]).map((change) => {
      keys(change, ['cell', 'value', 'formula', 'format'])
      const p = point(change.cell)
      if (
        p.row < r.start.row ||
        p.row > r.end.row ||
        p.col < r.start.col ||
        p.col > r.end.col ||
        seen.has(change.cell)
      )
        fail()
      seen.add(change.cell)
      if (own(change, 'value') && own(change, 'formula')) fail()
      const out: ValidatedChange = { cell: text(change.cell), p }
      if (own(change, 'value')) {
        const v = change.value
        out.value =
          v === null
            ? null
            : typeof v === 'string'
              ? { stringValue: text(v) }
              : typeof v === 'number'
                ? { numberValue: number(v) }
                : { boolValue: boolean(v) }
      }
      if (own(change, 'formula')) {
        const v = text(change.formula)
        if (!v.startsWith('=') || v.length < 2) fail()
        out.value = { formulaValue: v }
      }
      if (own(change, 'format'))
        out.format = change.format === null ? clearFormat(formatSchema) : format(change.format)
      if (!own(out, 'value') && !own(out, 'format')) fail()
      if (own(out, 'format')) {
        const masks: string[] = []
        patch({}, out.format!, 'userEnteredFormat', masks)
        if (!masks.length) fail()
      }
      return out
    })
    const before = await this.read({ fileId, range: r.range, signal }),
      after = clone(before),
      requests: UpdateRequest[] = []
    for (const change of validated) {
      const cell = after.cells[(change.p.row - r.start.row) * r.cols + change.p.col - r.start.col]!,
        update: CellUpdate = {},
        masks: string[] = []
      if (cell.isMerged)
        throw sheetsError(
          'unsupported',
          'Edits on merged cells are unsupported. Edit the merged range in Google Sheets.',
        )
      if (own(change, 'value') && !equal(cell.userEnteredValue, change.value)) {
        if (cell.hasRichText || cell.hasSmartChips)
          throw sheetsError(
            'unsupported',
            'Value edits on rich-text or smart-chip cells are unsupported because Google would erase their runs.',
          )
        if (cell.userEnteredValue === null && cell.effectiveValue !== null)
          throw sheetsError(
            'unsupported',
            'Value edits on calculated output cells are unsupported. Edit the source in Google Sheets.',
          )
        cell.userEnteredValue = change.value!
        cell.effectiveValue = null
        cell.formattedValue = ''
        cell.displayUncalculated = true
        if (change.value !== null) update.userEnteredValue = change.value!
        masks.push('userEnteredValue')
      }
      if (own(change, 'format')) {
        const delta = changedFormat(cell.userEnteredFormat, change.format!)
        if (Object.keys(delta).length) {
          update.userEnteredFormat = {}
          patch(update.userEnteredFormat, delta, 'userEnteredFormat', masks)
          patch(cell.userEnteredFormat, delta, 'userEnteredFormat', [])
          if (own(delta, 'numberFormat')) {
            cell.formattedValue = ''
            cell.displayUncalculated = true
          }
        }
      }
      if (!masks.length) continue
      requests.push({
        updateCells: {
          range: {
            sheetId: before.tab.sheetId,
            startRowIndex: change.p.row,
            endRowIndex: change.p.row + 1,
            startColumnIndex: change.p.col,
            endColumnIndex: change.p.col + 1,
          },
          rows: [{ values: [update] }],
          fields: masks.join(','),
        },
      })
    }
    if (!requests.length) throw sheetsError('noop', 'Google Sheets proposal contains no changes.')
    const proposal = freeze({
      version: 1,
      fileId: file(fileId),
      range: r.range,
      tab: clone(before.tab),
      before,
      after,
      requests,
    })
    if (JSON.stringify(proposal).length > 1_500_000) fail()
    this.#proposals.add(proposal)
    return proposal
  }
  // Sheets batchUpdate is atomic but has no revision CAS. A collaborator can edit
  // between this re-read and dispatch, or before readback. Never automatically retry.
  // https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate
  async apply(options: ApplyOptions): Promise<ApplyResult> {
    keys(options, ['proposal', 'signal', 'beforeDispatch'])
    const { proposal, signal, beforeDispatch } = options
    if (beforeDispatch !== undefined && typeof beforeDispatch !== 'function') fail()
    if (!this.#proposals.has(proposal))
      throw sheetsError('proposal', 'Google Sheets proposal is unavailable or already attempted.')
    this.#proposals.delete(proposal)
    const current = await this.read({ fileId: proposal.fileId, range: proposal.range, signal })
    if (comparison(current) !== comparison(proposal.before))
      throw sheetsError(
        'stale',
        'Google Sheets values, basic formats, or tab identity changed. Prepare a new preview.',
      )
    try {
      await this.#transport.request(url(proposal.fileId, { fields: 'spreadsheetId' }, true), {
        signal,
        body: JSON.stringify({ requests: proposal.requests, includeSpreadsheetInResponse: false }),
        beforeDispatch,
      })
    } catch (error) {
      if (errorField(error, 'code') === 'uncertain')
        return freeze({ status: 'uncertain', message: error instanceof Error ? error.message : '' })
      throw error
    }
    try {
      return freeze({
        status: 'applied',
        snapshot: await this.read({ fileId: proposal.fileId, range: proposal.range, signal }),
      })
    } catch {
      return freeze({
        status: 'uncertain',
        message:
          'Google Sheets accepted the write, but readback failed. Inspect the sheet before preparing another edit.',
      })
    }
  }
}
