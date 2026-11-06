import { TARGET_FIELDS, normalizeHeader, registerFieldLabels, requiredFields, type FieldDef } from './fields'
import type { CanonRow } from './normalize'

export type DatasetKey = 'sicantik' | 'oss_nib' | 'oss_projects' | 'oss_permits'
export type MatchKey = 'source_id' | 'application_number'

export interface DatasetDef {
  key: DatasetKey
  label: string
  short: string
  description: string
  sourceSystem: string
  fields: FieldDef[]
  keyField: (m: MatchKey) => string
  keyLabel: (m: MatchKey) => string
  required: (m: MatchKey) => string[]
  /** apakah memiliki pilihan kunci pencocokan & perlindungan edit manual */
  sicantik: boolean
  /** ringkasan baris untuk pratinjau */
  display: (r: CanonRow) => { title: string; subtitle?: string; meta?: string }
  /** tautan hasil impor */
  resultLink: (batchId: string) => { to: string; label: string }
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))

const OSS_NIB_FIELDS: FieldDef[] = [
  { key: 'nib', label: 'NIB', group: 'Pelaku usaha', required: true, synonyms: ['nib', 'nomorindukberusaha'] },
  { key: 'name', label: 'Nama perusahaan / pelaku usaha', group: 'Pelaku usaha', required: true, synonyms: ['namaperusahaan', 'namapelakuusaha', 'nama'] },
  { key: 'oss_issued_date', label: 'Tanggal terbit NIB (OSS)', group: 'Pelaku usaha', date: true, synonyms: ['tanggalterbitoss', 'tglterbitoss', 'tanggalterbitnib'] },
  { key: 'investment_status', label: 'Status penanaman modal', group: 'Pelaku usaha', hint: 'PMDN / PMA', synonyms: ['statuspenanamanmodal', 'uraianstatuspenanamanmodal'] },
  { key: 'company_type', label: 'Jenis perusahaan', group: 'Pelaku usaha', synonyms: ['uraianjenisperusahaan', 'jenisperusahaan'] },
  { key: 'business_scale', label: 'Skala usaha', group: 'Pelaku usaha', synonyms: ['uraianskalausaha', 'skalausaha'] },
  { key: 'address', label: 'Alamat', group: 'Lokasi', synonyms: ['alamatperusahaan', 'alamat'] },
  { key: 'kelurahan', label: 'Kelurahan / desa', group: 'Lokasi', synonyms: ['kelurahan', 'desa', 'desakelurahan'] },
  { key: 'kecamatan', label: 'Kecamatan', group: 'Lokasi', synonyms: ['kecamatan'] },
  { key: 'kab_kota', label: 'Kabupaten / kota', group: 'Lokasi', synonyms: ['kabkota', 'kabupatenkota'] },
]

const OSS_PROJECT_FIELDS: FieldDef[] = [
  { key: 'project_id', label: 'ID proyek', group: 'Proyek', required: true, synonyms: ['idproyek'] },
  { key: 'project_type', label: 'Jenis proyek', group: 'Proyek', synonyms: ['uraianjenisproyek', 'jenisproyek'] },
  { key: 'project_name', label: 'Nama proyek', group: 'Proyek', synonyms: ['namaproyek'] },
  { key: 'risk_level', label: 'Risiko proyek', group: 'Proyek', synonyms: ['uraianrisikoproyek', 'risikoproyek', 'risiko'] },
  { key: 'submitted_date', label: 'Tanggal pengajuan proyek', group: 'Proyek', date: true, synonyms: ['tanggalpengajuanproyek', 'tglpengajuanproyek'] },
  { key: 'kbli', label: 'KBLI', group: 'Proyek', synonyms: ['kbli'] },
  { key: 'kbli_title', label: 'Judul KBLI', group: 'Proyek', synonyms: ['judulkbli'] },
  { key: 'kl_sector', label: 'K/L / sektor pembina', group: 'Proyek', synonyms: ['klsektorpembina', 'klsektor', 'sektorpembina'] },
  { key: 'investment', label: 'Jumlah investasi (Rp)', group: 'Proyek', synonyms: ['jumlahinvestasi', 'investasi', 'nilaiinvestasi'] },
  { key: 'workers', label: 'Tenaga kerja (TKI)', group: 'Proyek', synonyms: ['tki', 'jumlahtki', 'tenagakerja'] },
  { key: 'land_area', label: 'Luas tanah', group: 'Proyek', hint: 'Format Indonesia dibaca otomatis: 1.035,34', synonyms: ['luastanah'] },
  { key: 'land_unit', label: 'Satuan luas', group: 'Proyek', synonyms: ['satuantanah', 'satuanluas'] },
  { key: 'nib', label: 'NIB', group: 'Pelaku usaha', required: true, synonyms: ['nib'] },
  { key: 'company_name', label: 'Nama perusahaan', group: 'Pelaku usaha', required: true, synonyms: ['namaperusahaan'] },
  { key: 'oss_issued_date', label: 'Tanggal terbit NIB (OSS)', group: 'Pelaku usaha', date: true, synonyms: ['tanggalterbitoss'] },
  { key: 'investment_status', label: 'Status penanaman modal', group: 'Pelaku usaha', synonyms: ['uraianstatuspenanamanmodal', 'statuspenanamanmodal'] },
  { key: 'company_type', label: 'Jenis perusahaan', group: 'Pelaku usaha', synonyms: ['uraianjenisperusahaan', 'jenisperusahaan'] },
  { key: 'business_scale', label: 'Skala usaha', group: 'Pelaku usaha', synonyms: ['uraianskalausaha', 'skalausaha'] },
  { key: 'address', label: 'Alamat usaha', group: 'Lokasi', synonyms: ['alamatusaha', 'alamat'] },
  { key: 'kelurahan', label: 'Kelurahan / desa', group: 'Lokasi', synonyms: ['kelurahanusaha', 'kelurahan'] },
  { key: 'kecamatan', label: 'Kecamatan', group: 'Lokasi', synonyms: ['kecamatanusaha', 'kecamatan'] },
  { key: 'kab_kota', label: 'Kabupaten / kota', group: 'Lokasi', synonyms: ['kabkotausaha', 'kabkota'] },
]

const OSS_PERMIT_FIELDS: FieldDef[] = [
  { key: 'permit_request_id', label: 'ID permohonan izin', group: 'Izin', required: true, synonyms: ['idpermohonanizin', 'idizin'] },
  { key: 'permit_date', label: 'Tanggal izin', group: 'Izin', required: true, date: true, synonyms: ['tglizin', 'tanggalizin'] },
  { key: 'permit_category', label: 'Jenis perizinan', group: 'Izin', required: true, hint: 'Persyaratan Dasar / Sertifikat Standar / Izin', synonyms: ['uraianjenisperizinan', 'jenisperizinan'] },
  { key: 'document_name', label: 'Nama dokumen', group: 'Izin', required: true, synonyms: ['namadokumen'] },
  { key: 'risk_code', label: 'Kode risiko', group: 'Izin', hint: 'R / MR / MT / T', synonyms: ['kdresiko', 'kdrisiko', 'koderisiko'] },
  { key: 'permit_status', label: 'Status perizinan', group: 'Izin', synonyms: ['statusperizinan'] },
  { key: 'kbli', label: 'KBLI', group: 'Izin', synonyms: ['kbli'] },
  { key: 'project_id', label: 'ID proyek', group: 'Izin', synonyms: ['idproyek'] },
  { key: 'authority', label: 'Kewenangan', group: 'Izin', synonyms: ['uraiankewenangan'] },
  { key: 'authority_official', label: 'Pejabat berwenang', group: 'Izin', synonyms: ['kewenangan'] },
  { key: 'kl_sector', label: 'K/L / sektor', group: 'Izin', synonyms: ['klsektor', 'klsektorpembina'] },
  { key: 'nib', label: 'NIB', group: 'Pelaku usaha', hint: 'Baris tanpa NIB tetap disimpan dengan peringatan', synonyms: ['nib'] },
  { key: 'company_name', label: 'Nama perusahaan', group: 'Pelaku usaha', required: true, synonyms: ['namaperusahaan'] },
  { key: 'oss_issued_date', label: 'Tanggal terbit NIB (OSS)', group: 'Pelaku usaha', date: true, synonyms: ['tanggalterbitoss'] },
  { key: 'investment_status', label: 'Status penanaman modal', group: 'Pelaku usaha', synonyms: ['uraianstatuspenanamanmodal', 'statuspenanamanmodal'] },
  { key: 'provinsi', label: 'Provinsi', group: 'Lokasi', synonyms: ['propinsi', 'provinsi'] },
  { key: 'kab_kota', label: 'Kabupaten / kota', group: 'Lokasi', synonyms: ['kabkota'] },
  { key: 'kecamatan', label: 'Kecamatan', group: 'Lokasi', synonyms: ['kecamatan'] },
  { key: 'kelurahan', label: 'Kelurahan / desa', group: 'Lokasi', synonyms: ['kelurahan'] },
]

const req = (fields: FieldDef[]) => () => fields.filter((f) => f.required).map((f) => f.key)

export const DATASETS: Record<DatasetKey, DatasetDef> = {
  sicantik: {
    key: 'sicantik', label: 'SiCANTIK — permohonan & izin terbit', short: 'SiCANTIK',
    description: 'Ekspor daftar permohonan SiCANTIK Cloud. Masuk ke Data permohonan & Izin terbit.',
    sourceSystem: 'SiCANTIK Cloud', fields: TARGET_FIELDS, sicantik: true,
    keyField: (m) => m, keyLabel: (m) => (m === 'source_id' ? 'ID SiCANTIK' : 'nomor permohonan'), required: requiredFields,
    display: (r) => ({ title: s(r.application_number), subtitle: s(r.applicant_name), meta: r.source_id ? `ID ${s(r.source_id)} · ${s(r.permit_type_name)}` : s(r.permit_type_name) }),
    resultLink: (id) => ({ to: `/pencarian?importBatchId=${id}`, label: 'Lihat arsip hasil impor' }),
  },
  oss_nib: {
    key: 'oss_nib', label: 'OSS — Data NIB (pelaku usaha)', short: 'OSS · NIB',
    description: 'Ekspor DP.NIB dari OSS RBA: satu baris per NIB.',
    sourceSystem: 'OSS RBA', fields: OSS_NIB_FIELDS, sicantik: false,
    keyField: () => 'nib', keyLabel: () => 'NIB', required: req(OSS_NIB_FIELDS),
    display: (r) => ({ title: s(r.name), subtitle: `NIB ${s(r.nib)}`, meta: [r.company_type, r.kecamatan].filter(Boolean).join(' · ') }),
    resultLink: () => ({ to: '/oss?tab=pelaku', label: 'Lihat data pelaku usaha' }),
  },
  oss_projects: {
    key: 'oss_projects', label: 'OSS — Data proyek (KBLI & investasi)', short: 'OSS · Proyek',
    description: 'Ekspor DP.Proyek dari OSS RBA: satu baris per ID proyek.',
    sourceSystem: 'OSS RBA', fields: OSS_PROJECT_FIELDS, sicantik: false,
    keyField: () => 'project_id', keyLabel: () => 'ID proyek', required: req(OSS_PROJECT_FIELDS),
    display: (r) => ({ title: s(r.project_name || r.company_name), subtitle: `${s(r.project_id)} · KBLI ${s(r.kbli)}`, meta: [r.company_name, r.risk_level].filter(Boolean).join(' · ') }),
    resultLink: () => ({ to: '/oss?tab=proyek', label: 'Lihat data proyek' }),
  },
  oss_permits: {
    key: 'oss_permits', label: 'OSS — Daftar izin (persyaratan dasar & sertifikat standar)', short: 'OSS · Izin',
    description: 'Ekspor List izin dari OSS RBA: satu baris per ID permohonan izin.',
    sourceSystem: 'OSS RBA', fields: OSS_PERMIT_FIELDS, sicantik: false,
    keyField: () => 'permit_request_id', keyLabel: () => 'ID permohonan izin', required: req(OSS_PERMIT_FIELDS),
    display: (r) => ({ title: s(r.document_name), subtitle: s(r.company_name), meta: [r.permit_request_id, r.risk_code, r.permit_status].filter(Boolean).join(' · ') }),
    resultLink: () => ({ to: '/oss?tab=izin', label: 'Lihat data izin OSS' }),
  },
}

Object.values(DATASETS).forEach((d) => registerFieldLabels(d.fields))

/** Tebak jenis file dari judul kolom. */
export function detectDataset(headers: string[]): DatasetKey {
  const h = new Set(headers.map(normalizeHeader))
  if (h.has('idpermohonanizin') || (h.has('namadokumen') && h.has('nib'))) return 'oss_permits'
  if (h.has('idproyek') && (h.has('kbli') || h.has('jumlahinvestasi'))) return 'oss_projects'
  if (h.has('nib') && (h.has('uraianskalausaha') || h.has('uraianjenisperusahaan')) && !h.has('idproyek')) return 'oss_nib'
  return 'sicantik'
}
