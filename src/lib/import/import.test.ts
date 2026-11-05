import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { autoMap, requiredFields } from './fields'
import { buildTable, guessHeaderRow, parseCsvText, parseWorkbookBuffer } from './parse'
import { buildCanonicalRows, excelSerialToIso, parseDateCell, textCell } from './normalize'

describe('normalisasi tanggal', () => {
  it('serial Excel', () => {
    expect(excelSerialToIso(46329)).toBe('2026-11-03')
    expect(excelSerialToIso(46329.75)).toBe('2026-11-03')
  })
  it('format teks umum', () => {
    const c = (raw: string) => ({ raw, text: raw })
    expect(parseDateCell(c('2026-11-03 00:00:00'), 'dmy')).toBe('2026-11-03')
    expect(parseDateCell(c('03/11/2026'), 'dmy')).toBe('2026-11-03')
    expect(parseDateCell(c('11/03/2026'), 'mdy')).toBe('2026-11-03')
    expect(parseDateCell(c('3 November 2026'), 'dmy')).toBe('2026-11-03')
    expect(parseDateCell(c('3 Agustus 2026'), 'dmy')).toBe('2026-08-03')
    expect(parseDateCell(c('31/02/2026'), 'dmy')).toBe('31/02/2026') // tidak valid -> dikembalikan apa adanya
    expect(parseDateCell(c('-'), 'dmy')).toBeNull()
  })
  it('angka bulat besar tidak menjadi notasi ilmiah', () => {
    expect(textCell({ raw: 5304000012340001, text: '5.304E+15' })).toBe('5304000012340001')
  })
})

describe('CSV & duplikat', () => {
  it('membaca CSV titik koma, memetakan otomatis, dan menandai duplikat', async () => {
    const csv = [
      'ID;No Permohonan;Izin;Jenis;Tanggal;Pemohon;No KTP;Nomor izin;Tanggal Penetapan',
      '1;A/1;SIP Bidan;Baru;05/01/2026;Ani;5304000000000001;-;-',
      '2;A/2;SIP Bidan;Baru;06/01/2026;Budi;5304000000000002;12/IZIN;07/01/2026',
      '1;A/1;SIP Bidan;Baru;05/01/2026;Ani;5304000000000001;-;-',
    ].join('\n')
    const [sheet] = await parseCsvText(csv)
    const table = buildTable(sheet, guessHeaderRow(sheet))
    const mapping = autoMap(table.headers)
    expect(mapping.source_id).toBe('ID')
    expect(mapping.application_type).toBe('Jenis')
    expect(mapping.permit_type_name).toBe('Izin')
    const { rows, issues } = buildCanonicalRows(table, mapping, { dateOrder: 'dmy', matchKey: 'source_id' })
    expect(rows).toHaveLength(2)
    expect(issues).toHaveLength(1)
    expect(issues[0].row_number).toBe(4)
    expect(rows[1].issued_date).toBe('2026-01-07')
    expect(rows[0].issued_date).toBeNull()
  })
})

const SAMPLE = process.env.IMPORT_SAMPLE
describe.skipIf(!SAMPLE || !existsSync(SAMPLE))('file ekspor SiCANTIK asli', () => {
  it('memetakan seluruh kolom dan menghasilkan baris kanonik', async () => {
    const buf = readFileSync(SAMPLE!)
    const sheets = await parseWorkbookBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), XLSX)
    const table = buildTable(sheets[0], guessHeaderRow(sheets[0]))
    const mapping = autoMap(table.headers)
    for (const f of requiredFields('source_id')) expect(mapping[f], f).toBeTruthy()
    expect(Object.keys(mapping)).toHaveLength(13)
    const { rows, issues } = buildCanonicalRows(table, mapping, { dateOrder: 'dmy', matchKey: 'source_id' })
    expect(issues).toHaveLength(0)
    expect(rows.length).toBeGreaterThan(800)
    expect(rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r.application_date)))).toBe(true)
    if (process.env.IMPORT_EXPECTED && existsSync(process.env.IMPORT_EXPECTED)) {
      const expected = JSON.parse(readFileSync(process.env.IMPORT_EXPECTED, 'utf8')) as Record<string, unknown>[]
      expect(rows.length).toBe(expected.length)
      const pick = (r: Record<string, unknown>) => [r.row_number, r.source_id, r.application_number, r.application_date, r.issued_date ?? '-', r.applicant_nik]
      rows.forEach((r, i) => expect(pick(r)).toEqual(pick(expected[i])))
    }
  })
})
