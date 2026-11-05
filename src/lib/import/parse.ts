import type * as XLSXType from 'xlsx'

export interface Cell {
  raw: unknown
  text: string
}

export interface ParsedSheet {
  name: string
  /** baris mentah, indeks 0 = baris pertama sheet */
  rows: { rowNumber: number; cells: Cell[] }[]
}

export interface ParsedFile {
  fileName: string
  size: number
  hash: string
  kind: 'xlsx' | 'xls' | 'csv'
  sheets: ParsedSheet[]
}

export interface DataTable {
  headers: string[]
  rows: { rowNumber: number; values: Record<string, Cell> }[]
}

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024
export const MAX_IMPORT_ROWS = 50000

async function sha256(buf: ArrayBuffer) {
  const h = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function decodeText(buf: ArrayBuffer) {
  const utf8 = new TextDecoder('utf-8').decode(buf)
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '')
  return new TextDecoder('windows-1252').decode(buf)
}

export async function parseWorkbookBuffer(buf: ArrayBuffer, XLSX: typeof XLSXType): Promise<ParsedSheet[]> {
  const wb = XLSX.read(buf, { type: 'array', cellDates: false, cellText: true, cellNF: true, dense: false })
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name]
    if (!ws || !ws['!ref']) return { name, rows: [] }
    const range = XLSX.utils.decode_range(ws['!ref'])
    const rows: ParsedSheet['rows'] = []
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cells: Cell[] = []
      let any = false
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSXType.CellObject | undefined
        if (!cell || cell.v === undefined || cell.v === null || cell.v === '') {
          cells.push({ raw: null, text: '' })
          continue
        }
        any = true
        cells.push({ raw: cell.v, text: (cell.w ?? String(cell.v)).trim() })
      }
      if (any) rows.push({ rowNumber: r + 1, cells })
    }
    return { name, rows }
  })
}

export async function parseCsvText(text: string): Promise<ParsedSheet[]> {
  const Papa = (await import('papaparse')).default
  const res = Papa.parse<string[]>(text, { skipEmptyLines: false, delimitersToGuess: [',', ';', '\t', '|'] })
  const rows: ParsedSheet['rows'] = []
  res.data.forEach((r, i) => {
    if (!r.some((v) => v && v.trim() !== '')) return
    rows.push({ rowNumber: i + 1, cells: r.map((v) => ({ raw: v === '' ? null : v, text: (v ?? '').trim() })) })
  })
  return [{ name: 'CSV', rows }]
}

export async function parseImportFile(file: File): Promise<ParsedFile> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error(`Ukuran file melebihi ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`)
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!ext || !['xlsx', 'xls', 'csv'].includes(ext)) throw new Error('Format file harus XLSX, XLS, atau CSV.')
  const buf = await file.arrayBuffer()
  const hash = await sha256(buf)
  let sheets: ParsedSheet[]
  if (ext === 'csv') {
    sheets = await parseCsvText(decodeText(buf))
  } else {
    const XLSX = await import('xlsx')
    try {
      sheets = await parseWorkbookBuffer(buf, XLSX)
    } catch {
      throw new Error('File Excel tidak dapat dibaca. Pastikan file tidak rusak atau terkunci kata sandi.')
    }
  }
  sheets = sheets.filter((s) => s.rows.length > 0)
  if (!sheets.length) throw new Error('File tidak berisi data.')
  return { fileName: file.name, size: file.size, hash, kind: ext as ParsedFile['kind'], sheets }
}

/** Tebak baris judul: baris pertama (dari 20 teratas) dengan sel terisi terbanyak. */
export function guessHeaderRow(sheet: ParsedSheet) {
  let best = 0
  let bestCount = -1
  sheet.rows.slice(0, 20).forEach((r, i) => {
    const n = r.cells.filter((c) => c.text && Number.isNaN(Number(c.text))).length
    if (n > bestCount) { best = i; bestCount = n }
  })
  return best
}

export function buildTable(sheet: ParsedSheet, headerIndex: number): DataTable {
  const headerRow = sheet.rows[headerIndex]
  if (!headerRow) return { headers: [], rows: [] }
  const seen = new Map<string, number>()
  const colHeaders = headerRow.cells.map((c, i) => {
    let h = c.text || `Kolom ${i + 1}`
    const n = seen.get(h) ?? 0
    seen.set(h, n + 1)
    if (n) h = `${h} (${n + 1})`
    return h
  })
  const rows = sheet.rows.slice(headerIndex + 1).map((r) => {
    const values: Record<string, Cell> = {}
    colHeaders.forEach((h, i) => { values[h] = r.cells[i] ?? { raw: null, text: '' } })
    return { rowNumber: r.rowNumber, values }
  })
  return { headers: colHeaders.filter((h) => !/^Kolom \d+$/.test(h) || rows.some((r) => r.values[h]?.text)), rows }
}
