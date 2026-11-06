import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { autoMap } from './fields'
import { DATASETS, detectDataset, type DatasetKey } from './datasets'
import { buildTable, guessHeaderRow, parseWorkbookBuffer } from './parse'
import { buildCanonicalRows, detectDateOrder } from './normalize'

describe('deteksi dataset', () => {
  it('mengenali ekspor OSS dari judul kolom', () => {
    expect(detectDataset(['No.', 'Id Permohonan Izin', 'Nama Perusahaan', 'Nib', 'Nama Dokumen'])).toBe('oss_permits')
    expect(detectDataset(['No.', 'Id Proyek', 'Nib', 'Kbli', 'Jumlah Investasi'])).toBe('oss_projects')
    expect(detectDataset(['No.', 'nib', 'Day of tanggal_terbit_oss', 'uraian_skala_usaha'])).toBe('oss_nib')
    expect(detectDataset(['ID', 'No Permohonan', 'Izin', 'Pemohon'])).toBe('sicantik')
  })
})

const DIR = process.env.OSS_DIR
const FILES: [DatasetKey, string, number, 'dmy' | 'mdy'][] = [
  ['oss_permits', 'c2355a03-List_izin_5.xlsx', 344, 'dmy'],
  ['oss_nib', '2c3a142b-DP.NIB_Kantor_6.xlsx', 80, 'mdy'],
  ['oss_projects', '01ef6224-DP.Proyek_2.xlsx', 200, 'dmy'],
]
describe.skipIf(!DIR || !existsSync(DIR))('file ekspor OSS asli', () => {
  it.each(FILES)('%s: deteksi, pemetaan, format tanggal', async (key, file, n, order) => {
    const buf = readFileSync(path.join(DIR!, file))
    const [sheet] = await parseWorkbookBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), XLSX)
    const table = buildTable(sheet, guessHeaderRow(sheet))
    expect(detectDataset(table.headers)).toBe(key)
    const def = DATASETS[key]
    const mapping = autoMap(table.headers, def.fields)
    for (const f of def.required('source_id')) expect(mapping[f], f).toBeTruthy()
    expect(Object.keys(mapping).length).toBe(def.fields.length)
    expect(detectDateOrder(table, mapping, def.fields)).toBe(order)
    const { rows, issues } = buildCanonicalRows(table, mapping, { dateOrder: order, keyField: def.keyField('source_id'), fields: def.fields })
    expect(issues).toHaveLength(0)
    expect(rows).toHaveLength(n)
    const dateKeys = def.fields.filter((f) => f.date).map((f) => f.key)
    expect(rows.every((r) => dateKeys.every((k) => r[k] === null || /^\d{4}-\d{2}-\d{2}$/.test(String(r[k]))))).toBe(true)
  })
})
