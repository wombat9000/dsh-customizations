import type { SignalOptions } from './types.js'
export type FormatValue = string | number | boolean | null | FormatObject
export interface FormatObject {
  [key: string]: FormatValue
}
export interface SheetValue {
  stringValue?: string
  numberValue?: number
  boolValue?: boolean
  formulaValue?: string
  errorValue?: { type: string; message: string }
}
export interface Tab {
  sheetId: number
  title: string
  rowCount: number
  columnCount: number
}
export interface Cell {
  cell: string
  userEnteredValue: SheetValue | null
  effectiveValue: SheetValue | null
  formattedValue: string
  userEnteredFormat: FormatObject
  hasRichText?: boolean
  hasSmartChips?: boolean
  isMerged?: boolean
  displayUncalculated?: boolean
}
export interface Snapshot {
  fileId: string
  range: string
  tab: Tab
  cells: Cell[]
}
export interface CellUpdate {
  userEnteredValue?: SheetValue
  userEnteredFormat?: FormatObject
}
export interface UpdateRequest {
  updateCells: {
    range: {
      sheetId: number
      startRowIndex: number
      endRowIndex: number
      startColumnIndex: number
      endColumnIndex: number
    }
    rows: { values: CellUpdate[] }[]
    fields: string
  }
}
export interface Proposal {
  version: number
  fileId: string
  range: string
  tab: Tab
  before: Snapshot
  after: Snapshot
  requests: UpdateRequest[]
}
export interface DescribeOptions extends SignalOptions {
  fileId?: string | undefined
}
export interface ReadOptions extends DescribeOptions {
  range?: string | undefined
}
export interface PrepareOptions extends ReadOptions {
  changes?: unknown
}
export interface ApplyOptions extends SignalOptions {
  proposal: Proposal
  beforeDispatch?: (() => unknown) | undefined
}
export type ApplyResult =
  { status: 'uncertain'; message: string } | { status: 'applied'; snapshot: Snapshot }
export interface Point {
  col: number
  row: number
}
export interface Range {
  title: string
  start: Point
  end: Point
  rows: number
  cols: number
  range: string
}
