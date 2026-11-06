/**
 * Logika matriks rekap izin (model "Rekapan izin harian, mingguan, bulanan").
 * Murni tanpa React/Supabase agar mudah diuji.
 */

export type Granularity = 'day' | 'week' | 'month'
export type RowDimension = 'permit_type' | 'location' | 'district'

export interface DailyCount {
  day: string // YYYY-MM-DD
  permit_type_id: string
  application_type: string
  location: string | null
  total: number
}

export interface PermitTypeLite {
  id: string
  name: string
  sector: string
  report_group: string | null
  report_order: number
  is_active: boolean
}

export interface RecapColumn {
  key: string
  /** baris judul atas: huruf hari / "Mg" / nama bulan */
  top: string
  /** baris judul bawah: tanggal / nomor minggu / tahun */
  bottom: string
  kind: 'day' | 'week' | 'month' | 'total'
  /** kolom subtotal (diberi warna abu seperti spreadsheet) */
  subtotal: boolean
  /** hari-hari (YYYY-MM-DD) yang dijumlahkan kolom ini */
  days: Set<string>
  title: string
}

export interface RecapRow {
  type: 'section' | 'item' | 'subtotal' | 'total'
  key: string
  number: string
  label: string
  values: number[]
}

const DAY_SHORT = ['M', 'Sn', 'Sl', 'R', 'K', 'J', 'S'] // Minggu..Sabtu (Date.getUTCDay)
const DAY_LONG = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
export const MONTH_LONG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

const parse = (iso: string) => new Date(`${iso}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
export function daysBetween(from: string, to: string) {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}
const roman = (n: number) => ROMAN[n - 1] ?? String(n)

export function formatIdDate(s: string) {
  const d = parse(s)
  return `${d.getUTCDate()} ${MONTH_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export const MAX_DAYS: Record<Granularity, number> = { day: 31, week: 186, month: 1096 }

/** Kolom matriks. Minggu dimulai Senin dan ditutup hari Minggu (seperti spreadsheet rekapan). */
export function buildColumns(from: string, to: string, g: Granularity): RecapColumn[] {
  const days = daysBetween(from, to)
  const cols: RecapColumn[] = []
  if (g === 'day') {
    let week: string[] = []
    let n = 0
    days.forEach((d, i) => {
      const dow = parse(d).getUTCDay()
      cols.push({ key: d, top: DAY_SHORT[dow], bottom: String(parse(d).getUTCDate()), kind: 'day', subtotal: false, days: new Set([d]), title: `${DAY_LONG[dow]}, ${formatIdDate(d)}` })
      week.push(d)
      if (dow === 0 || i === days.length - 1) {
        n++
        cols.push({ key: `w${n}`, top: 'Mg', bottom: roman(n), kind: 'week', subtotal: true, days: new Set(week), title: `Minggu ke-${n}: ${formatIdDate(week[0])} – ${formatIdDate(week[week.length - 1])}` })
        week = []
      }
    })
  } else if (g === 'week') {
    let week: string[] = []
    let n = 0
    days.forEach((d, i) => {
      week.push(d)
      if (parse(d).getUTCDay() === 0 || i === days.length - 1) {
        n++
        const a = parse(week[0]), b = parse(week[week.length - 1])
        const range = a.getUTCMonth() === b.getUTCMonth()
          ? `${a.getUTCDate()}–${b.getUTCDate()} ${MONTH_SHORT[b.getUTCMonth()]}`
          : `${a.getUTCDate()} ${MONTH_SHORT[a.getUTCMonth()]}–${b.getUTCDate()} ${MONTH_SHORT[b.getUTCMonth()]}`
        cols.push({ key: `w${n}`, top: `Mg ${roman(n)}`, bottom: range, kind: 'week', subtotal: false, days: new Set(week), title: `${formatIdDate(week[0])} – ${formatIdDate(week[week.length - 1])}` })
        week = []
      }
    })
  } else {
    const byMonth = new Map<string, string[]>()
    days.forEach((d) => { const k = d.slice(0, 7); byMonth.set(k, [...(byMonth.get(k) ?? []), d]) })
    byMonth.forEach((ds, k) => {
      const m = Number(k.slice(5)) - 1
      cols.push({ key: k, top: MONTH_SHORT[m], bottom: k.slice(0, 4), kind: 'month', subtotal: false, days: new Set(ds), title: `${MONTH_LONG[m]} ${k.slice(0, 4)}` })
    })
  }
  cols.push({ key: 'total', top: 'Jml', bottom: '', kind: 'total', subtotal: true, days: new Set(days), title: 'Jumlah periode' })
  return cols
}

export function normalizeLocation(s: string | null) {
  return s?.trim() ? s.trim().toUpperCase().replace(/\s+/g, ' ') : null
}

export interface LocationRule { pattern: string; label: string }

export function districtOf(location: string | null, rules: LocationRule[]) {
  if (!location) return null
  for (const r of rules) {
    try {
      if (new RegExp(r.pattern, 'i').test(location)) return r.label
    } catch {
      /* pola tidak valid diabaikan */
    }
  }
  return null
}

interface BuildOptions {
  counts: DailyCount[]
  columns: RecapColumn[]
  dimension: RowDimension
  permitTypes: PermitTypeLite[]
  locationRules: LocationRule[]
  showZeroRows: boolean
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Susun baris matriks: bagian (huruf), item bernomor, subtotal per bagian, dan total keseluruhan. */
export function buildMatrix({ counts, columns, dimension, permitTypes, locationRules, showZeroRows }: BuildOptions): RecapRow[] {
  const colIndex = new Map<string, number[]>()
  columns.forEach((c, i) => c.days.forEach((d) => colIndex.set(d, [...(colIndex.get(d) ?? []), i])))
  const zero = () => columns.map(() => 0)

  const keyOf = (c: DailyCount) => {
    if (dimension === 'permit_type') return c.permit_type_id
    if (dimension === 'location') return normalizeLocation(c.location) ?? '∅'
    return districtOf(c.location, locationRules) ?? '∅'
  }
  const agg = new Map<string, number[]>()
  for (const c of counts) {
    const idx = colIndex.get(c.day)
    if (!idx) continue
    const k = keyOf(c)
    const v = agg.get(k) ?? zero()
    idx.forEach((i) => { v[i] += Number(c.total) })
    agg.set(k, v)
  }

  const rows: RecapRow[] = []
  const grand = zero()
  const pushSection = (letter: string, title: string, items: { key: string; label: string }[]) => {
    const sub = zero()
    rows.push({ type: 'section', key: `s-${letter}`, number: letter, label: title, values: [] })
    items.forEach((it, i) => {
      const v = agg.get(it.key) ?? zero()
      v.forEach((x, j) => { sub[j] += x })
      rows.push({ type: 'item', key: it.key, number: String(i + 1), label: it.label, values: v })
    })
    rows.push({ type: 'subtotal', key: `t-${letter}`, number: '', label: `JUMLAH ${letter}`, values: sub })
    sub.forEach((x, j) => { grand[j] += x })
  }

  if (dimension === 'permit_type') {
    const used = new Set(agg.keys())
    const types = permitTypes.filter((t) => used.has(t.id) || (showZeroRows && t.is_active))
    const sections = new Map<string, PermitTypeLite[]>()
    types.forEach((t) => {
      const title = t.report_group?.trim() ? `${t.report_group.trim()} — ${t.sector}` : t.sector
      sections.set(title, [...(sections.get(title) ?? []), t])
    })
    const ordered = Array.from(sections.entries()).sort(([a, ta], [b, tb]) => {
      const ga = ta[0].report_group ?? '￿', gb = tb[0].report_group ?? '￿'
      return ga.localeCompare(gb, 'id') || a.localeCompare(b, 'id')
    })
    ordered.forEach(([title, ts], i) => {
      ts.sort((a, b) => a.report_order - b.report_order || a.name.localeCompare(b.name, 'id'))
      pushSection(LETTERS[i] ?? String(i + 1), title.toUpperCase(), ts.map((t) => ({ key: t.id, label: t.name })))
    })
  } else {
    const total = columns.length - 1
    const items = Array.from(agg.entries())
      .filter(([, v]) => v[total] > 0)
      .sort(([ka, a], [kb, b]) => (ka === '∅' ? 1 : kb === '∅' ? -1 : b[total] - a[total] || ka.localeCompare(kb, 'id')))
      .map(([k]) => ({ key: k, label: k === '∅' ? (dimension === 'district' ? 'Belum teridentifikasi' : 'Tanpa keterangan lokasi') : k }))
    if (dimension === 'district' && showZeroRows) {
      const present = new Set(items.map((i) => i.key))
      Array.from(new Set(locationRules.map((r) => r.label))).forEach((l) => { if (!present.has(l)) items.push({ key: l, label: l }) })
      items.sort((a, b) => (a.key === '∅' ? 1 : b.key === '∅' ? -1 : a.label.localeCompare(b.label, 'id')))
    }
    pushSection('A', dimension === 'district' ? 'PER KECAMATAN' : 'PER LOKASI IZIN', items)
  }
  rows.push({ type: 'total', key: 'grand', number: '', label: 'TOTAL', values: grand })
  return rows
}

export function periodLabel(from: string, to: string) {
  const a = parse(from), b = parse(to)
  const lastDay = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 0)).getUTCDate()
  if (a.getUTCDate() === 1 && b.getUTCDate() === lastDay) {
    if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) return `Bulan ${MONTH_LONG[a.getUTCMonth()]} ${a.getUTCFullYear()}`
    if (a.getUTCMonth() === 0 && b.getUTCMonth() === 11 && a.getUTCFullYear() === b.getUTCFullYear()) return `Tahun ${a.getUTCFullYear()}`
  }
  return from === to ? formatIdDate(from) : `${formatIdDate(from)} s.d. ${formatIdDate(to)}`
}
