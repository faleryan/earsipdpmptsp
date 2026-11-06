import { describe, expect, it } from 'vitest'
import { buildColumns, buildMatrix, districtOf, periodLabel, type DailyCount, type PermitTypeLite } from './recap'

describe('kolom rekap', () => {
  it('harian Oktober 2026: minggu ditutup hari Minggu seperti spreadsheet', () => {
    const cols = buildColumns('2026-10-01', '2026-10-31', 'day')
    // 1 Okt 2026 = Kamis
    expect(cols.slice(0, 5).map((c) => `${c.top}${c.bottom}`)).toEqual(['K1', 'J2', 'S3', 'M4', 'MgI'])
    expect(cols.filter((c) => c.kind === 'week').map((c) => c.bottom)).toEqual(['I', 'II', 'III', 'IV', 'V'])
    expect(cols.filter((c) => c.kind === 'day')).toHaveLength(31)
    expect(cols.at(-1)!.kind).toBe('total')
  })
  it('mingguan dan bulanan', () => {
    expect(buildColumns('2026-10-01', '2026-10-31', 'week').filter((c) => c.kind === 'week')).toHaveLength(5)
    const m = buildColumns('2026-01-01', '2026-12-31', 'month')
    expect(m.filter((c) => c.kind === 'month').map((c) => c.top)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'])
  })
  it('label periode', () => {
    expect(periodLabel('2026-10-01', '2026-10-31')).toBe('Bulan Oktober 2026')
    expect(periodLabel('2026-01-01', '2026-12-31')).toBe('Tahun 2026')
    expect(periodLabel('2026-10-05', '2026-10-11')).toBe('5 Oktober 2026 s.d. 11 Oktober 2026')
  })
})

describe('matriks rekap', () => {
  const types: PermitTypeLite[] = [
    { id: 'a', name: 'SIP Bidan', sector: 'Kesehatan', report_group: null, report_order: 0, is_active: true },
    { id: 'b', name: 'SIP Perawat', sector: 'Kesehatan', report_group: null, report_order: 0, is_active: true },
    { id: 'c', name: 'KKPR', sector: 'Tata Ruang', report_group: null, report_order: 0, is_active: true },
    { id: 'd', name: 'Izin lama', sector: 'Lainnya', report_group: null, report_order: 0, is_active: false },
  ]
  const counts: DailyCount[] = [
    { day: '2026-10-01', permit_type_id: 'a', application_type: 'Baru', location: 'Puskesmas Wedomu', total: 2 },
    { day: '2026-10-05', permit_type_id: 'a', application_type: 'Baru', location: 'Desa X, Tasifeto Timur', total: 1 },
    { day: '2026-10-05', permit_type_id: 'c', application_type: 'Baru', location: null, total: 3 },
    { day: '2026-09-30', permit_type_id: 'c', application_type: 'Baru', location: null, total: 9 },
  ]
  const cols = buildColumns('2026-10-01', '2026-10-31', 'day')
  const T = cols.length - 1

  it('per jenis izin dengan subtotal minggu, bagian per sektor, dan total', () => {
    const rows = buildMatrix({ counts, columns: cols, dimension: 'permit_type', permitTypes: types, locationRules: [], showZeroRows: true })
    const item = (k: string) => rows.find((r) => r.type === 'item' && r.key === k)!
    expect(item('a').values[T]).toBe(3)
    expect(item('a').values[4]).toBe(2) // Mg I
    expect(item('b').values[T]).toBe(0) // baris nol tetap tampil
    expect(rows.some((r) => r.key === 'd')).toBe(false) // nonaktif & nol disembunyikan
    expect(rows.find((r) => r.type === 'total')!.values[T]).toBe(6) // 30 Sep di luar rentang
    expect(rows.filter((r) => r.type === 'section').map((r) => r.label)).toEqual(['KESEHATAN', 'TATA RUANG'])
  })

  it('per kecamatan memakai aturan pola', () => {
    const rules = [{ pattern: 'tasifeto timur|wedomu', label: 'Tasifeto Timur' }]
    expect(districtOf('UPTD PUSKESMAS WEDOMU', rules)).toBe('Tasifeto Timur')
    const rows = buildMatrix({ counts, columns: cols, dimension: 'district', permitTypes: types, locationRules: rules, showZeroRows: false })
    const items = rows.filter((r) => r.type === 'item')
    expect(items.map((r) => [r.label, r.values[T]])).toEqual([['Tasifeto Timur', 3], ['Belum teridentifikasi', 3]])
  })
})
