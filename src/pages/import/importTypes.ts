import { supabase } from '@/lib/supabase'
import { exportRawExcel } from '@/lib/export'
import { fieldLabel } from '@/lib/import/fields'
import { IMPORT_ERROR_TYPES } from '@/lib/constants'
import type { ImportError } from '@/types'

export type RowStatus = 'new' | 'unchanged' | 'changed' | 'conflict' | 'error'

export interface PreviewResult {
  row_number: number
  status: RowStatus
  application_id: string | null
  reason: 'manual_record' | 'manual_edit' | null
  message: string | null
  changes: { field: string; old: unknown; new: unknown }[]
  conflict_fields: string[]
  errors: { field: string; message: string }[]
  warnings: { field: string; message: string }[]
}

export interface MappingTemplate {
  name: string
  mapping: Record<string, string>
  match_key: 'source_id' | 'application_number'
  date_order: 'dmy' | 'mdy'
  created_at: string
}

export const STATUS_META: Record<RowStatus, { label: string; tone: string; description: string }> = {
  new: { label: 'Baru', tone: 'text-primary', description: 'Belum ada di arsip, akan ditambahkan.' },
  changed: { label: 'Berubah', tone: 'text-[#8a5a12]', description: 'Sudah ada, tetapi data di SiCANTIK berubah sejak impor terakhir.' },
  conflict: { label: 'Konflik data manual', tone: 'text-destructive', description: 'Berubah di SiCANTIK, padahal kolom yang sama pernah diubah manual di E-Arsip.' },
  unchanged: { label: 'Tidak berubah', tone: 'text-muted-foreground', description: 'Sama persis dengan impor sebelumnya, dilewati.' },
  error: { label: 'Gagal validasi', tone: 'text-destructive', description: 'Data wajib kosong atau format tidak valid.' },
}

export const formatValue = (v: unknown) => (v === null || v === undefined || v === '' ? '∅' : String(v))

/** Unduh laporan kesalahan & peringatan sebuah batch */
export async function downloadErrorReport(batchId: string, fileName: string) {
  const all: ImportError[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('import_errors').select('*').eq('batch_id', batchId)
      .order('row_number', { ascending: true, nullsFirst: true }).order('created_at').range(from, from + 999)
    if (error) throw error
    all.push(...(data as ImportError[]))
    if (data.length < 1000) break
  }
  const flatten = (e: ImportError) => {
    const raw = (e.raw_data && typeof e.raw_data === 'object' && 'row' in (e.raw_data as object)
      ? (e.raw_data as { row: Record<string, unknown> }).row
      : e.raw_data) as Record<string, unknown> | null
    const base: Record<string, unknown> = {
      'Baris di file': e.row_number ?? '',
      Tingkat: e.severity === 'error' ? 'Galat' : 'Peringatan',
      Jenis: IMPORT_ERROR_TYPES[e.error_type] ?? e.error_type,
      Kolom: e.field ? e.field.split(', ').map(fieldLabel).join(', ') : '',
      Pesan: e.message,
      'ID SiCANTIK': e.source_id ?? '',
      'No. Permohonan': e.application_number ?? '',
    }
    if (raw) Object.entries(raw).forEach(([k, v]) => { if (k !== 'row_number') base[`Data: ${fieldLabel(k)}`] = v ?? '' })
    return base
  }
  await exportRawExcel(
    [
      { name: 'Galat', rows: all.filter((e) => e.severity === 'error').map(flatten) },
      { name: 'Dilewati', rows: all.filter((e) => e.severity === 'warning' && e.error_type !== 'validation').map(flatten) },
      { name: 'Peringatan', rows: all.filter((e) => e.severity === 'warning' && e.error_type === 'validation').map(flatten) },
    ],
    `laporan-impor-${fileName.replace(/\.[^.]+$/, '')}`,
  )
}
