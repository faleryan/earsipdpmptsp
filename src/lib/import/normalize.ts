import { TARGET_FIELDS, type Mapping, type TargetField } from './fields'
import type { Cell, DataTable } from './parse'

export type DateOrder = 'dmy' | 'mdy'

export interface CanonRow {
  row_number: number
  [k: string]: string | number | null
}

export interface ClientIssue {
  row_number: number
  field?: string
  type: 'duplicate_in_file'
  message: string
  row: CanonRow
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3,
  apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, agus: 8, agustus: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, nop: 11, november: 11, nopember: 11,
  des: 12, desember: 12, dec: 12, december: 12,
}

const pad = (n: number) => String(n).padStart(2, '0')

function validYmd(y: number, m: number, d: number) {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d > dim) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/** Konversi serial tanggal Excel (sistem 1900) ke Y-M-D tanpa terpengaruh zona waktu. */
export function excelSerialToIso(serial: number) {
  if (!Number.isFinite(serial) || serial < 1 || serial > 80000) return null
  const ms = Math.round((Math.floor(serial) - 25569) * 86400 * 1000)
  const d = new Date(ms)
  return validYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** Mengembalikan YYYY-MM-DD, atau teks asli bila tidak dikenali (server akan menandai sebagai galat). */
export function parseDateCell(cell: Cell | undefined, order: DateOrder): string | null {
  if (!cell || cell.raw === null || cell.raw === undefined || cell.text === '') return null
  if (typeof cell.raw === 'number') return excelSerialToIso(cell.raw) ?? String(cell.raw)
  if (cell.raw instanceof Date) return validYmd(cell.raw.getFullYear(), cell.raw.getMonth() + 1, cell.raw.getDate())
  const s = String(cell.raw).trim()
  if (s === '-' || s === '') return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/)
  if (m) return validYmd(+m[1], +m[2], +m[3]) ?? s
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s.*)?$/)
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const [d, mo] = order === 'dmy' ? [+m[1], +m[2]] : [+m[2], +m[1]]
    return validYmd(y, mo, d) ?? s
  }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})/)
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()]
    return mo ? validYmd(+m[3], mo, +m[1]) ?? s : s
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToIso(Number(s)) ?? s
  return s
}

/** Nilai teks sel. Angka bulat dipertahankan utuh (mis. NIK/ID tanpa notasi ilmiah). */
export function textCell(cell: Cell | undefined): string | null {
  if (!cell || cell.raw === null || cell.raw === undefined) return null
  if (typeof cell.raw === 'number') {
    if (Number.isInteger(cell.raw)) return cell.raw.toLocaleString('fullwide', { useGrouping: false })
    return cell.text || String(cell.raw)
  }
  if (typeof cell.raw === 'boolean') return cell.raw ? 'Ya' : 'Tidak'
  const s = String(cell.raw).replace(/\s+/g, ' ').trim()
  return s === '' ? null : s
}

export function buildCanonicalRows(
  table: DataTable,
  mapping: Mapping,
  opts: { dateOrder: DateOrder; matchKey: 'source_id' | 'application_number' },
) {
  const rows: CanonRow[] = []
  const issues: ClientIssue[] = []
  const seen = new Map<string, number>()

  for (const r of table.rows) {
    const canon: CanonRow = { row_number: r.rowNumber }
    for (const f of TARGET_FIELDS) {
      const src = mapping[f.key as TargetField]
      if (!src) continue
      const cell = r.values[src]
      canon[f.key] = f.date ? parseDateCell(cell, opts.dateOrder) : textCell(cell)
    }
    // baris kosong total dilewati
    if (Object.keys(canon).filter((k) => k !== 'row_number').every((k) => canon[k] === null)) continue

    const keyRaw = canon[opts.matchKey]
    const key = typeof keyRaw === 'string' ? keyRaw.trim().toLowerCase() : keyRaw
    if (key !== null && key !== undefined && key !== '' && key !== '-') {
      const first = seen.get(String(key))
      if (first !== undefined) {
        issues.push({
          row_number: r.rowNumber,
          field: opts.matchKey,
          type: 'duplicate_in_file',
          message: `Duplikat dalam file: ${opts.matchKey === 'source_id' ? 'ID SiCANTIK' : 'nomor permohonan'} "${keyRaw}" sudah ada di baris ${first}`,
          row: canon,
        })
        continue
      }
      seen.set(String(key), r.rowNumber)
    }
    rows.push(canon)
  }
  return { rows, issues }
}

/** Contoh nilai untuk pratinjau pemetaan */
export function sampleValues(table: DataTable, header: string, n = 3) {
  const out: string[] = []
  for (const r of table.rows) {
    const t = r.values[header]?.text
    if (t) out.push(t)
    if (out.length >= n) break
  }
  return out
}
