import type { AccessLevel, DocumentCategory, RoleCode } from '@/types'

export const DOCUMENT_CATEGORIES: { value: DocumentCategory; label: string; short: string }[] = [
  { value: 'surat_permohonan', label: 'Surat permohonan', short: 'Permohonan' },
  { value: 'identitas_pemohon', label: 'Identitas pemohon', short: 'Identitas' },
  { value: 'dokumen_persyaratan', label: 'Dokumen persyaratan', short: 'Persyaratan' },
  { value: 'rekomendasi_teknis', label: 'Rekomendasi teknis', short: 'Rekomendasi' },
  { value: 'berita_acara', label: 'Berita acara', short: 'Berita acara' },
  { value: 'surat_keputusan', label: 'Surat keputusan / izin', short: 'SK / Izin' },
  { value: 'dokumen_pendukung', label: 'Dokumen pendukung', short: 'Pendukung' },
]
export const categoryLabel = (c: string) => DOCUMENT_CATEGORIES.find((x) => x.value === c)?.label ?? c
export const categoryShort = (c: string) => DOCUMENT_CATEGORIES.find((x) => x.value === c)?.short ?? c

export const ROLE_LABELS: Record<RoleCode, string> = {
  super_admin: 'Super Admin',
  admin_arsip: 'Admin Arsip',
  operator: 'Operator',
  pimpinan: 'Pimpinan',
}

export const ACCESS_LEVELS: { value: AccessLevel; label: string; hint: string }[] = [
  { value: 'biasa', label: 'Biasa', hint: 'Dapat dilihat semua pengguna aktif' },
  { value: 'terbatas', label: 'Terbatas', hint: 'Super Admin, Admin Arsip, Pimpinan, dan pengunggah' },
  { value: 'rahasia', label: 'Rahasia', hint: 'Hanya Super Admin, Admin Arsip, dan Pimpinan' },
]
export const accessLabel = (v: string) => ACCESS_LEVELS.find((x) => x.value === v)?.label ?? v

export const APPLICATION_STATUS: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'muted' }> = {
  proses: { label: 'Dalam proses', variant: 'warning' },
  terbit: { label: 'Izin terbit', variant: 'success' },
  ditolak: { label: 'Ditolak', variant: 'danger' },
  dibatalkan: { label: 'Dibatalkan', variant: 'muted' },
}

export const PERMIT_STATUS: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'muted' }> = {
  aktif: { label: 'Aktif', variant: 'success' },
  dicabut: { label: 'Dicabut', variant: 'danger' },
  kedaluwarsa: { label: 'Kedaluwarsa', variant: 'muted' },
  dibekukan: { label: 'Dibekukan', variant: 'warning' },
}

export const APPLICATION_TYPES = ['Baru', 'Perpanjangan', 'Perubahan', 'Pencabutan', 'Lainnya']

export const BUSINESS_FORMS = ['PT', 'CV', 'Firma', 'Koperasi', 'Yayasan', 'Perkumpulan', 'BUMD', 'BUMDes', 'Perorangan', 'Lainnya']

export const SECTORS = ['Kesehatan', 'Tata Ruang', 'Pendidikan', 'Sosial', 'Aset Daerah', 'Penelitian', 'Usaha', 'Lainnya']

export const FINAL_DISPOSITION: Record<string, string> = {
  musnah: 'Musnah',
  permanen: 'Permanen',
  dinilai_kembali: 'Dinilai kembali',
}

export const IMPORT_STATUS: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'muted' }> = {
  draft: { label: 'Draf', variant: 'muted' },
  processing: { label: 'Sedang diproses', variant: 'default' },
  completed: { label: 'Selesai', variant: 'success' },
  completed_with_errors: { label: 'Selesai dengan kesalahan', variant: 'warning' },
  failed: { label: 'Gagal', variant: 'danger' },
  cancelled: { label: 'Dibatalkan', variant: 'muted' },
}

export const IMPORT_ERROR_TYPES: Record<string, string> = {
  validation: 'Validasi',
  duplicate_in_file: 'Duplikat dalam file',
  conflict: 'Konflik',
  manual_protected: 'Dilindungi (edit manual)',
  skipped: 'Dilewati',
  database: 'Penyimpanan',
}

export const ACTIVITY_LABELS: Record<string, string> = {
  insert: 'Menambah',
  update: 'Mengubah',
  delete: 'Menghapus',
  login: 'Masuk',
  logout: 'Keluar',
  'document.preview': 'Pratinjau dokumen',
  'document.download': 'Unduh dokumen',
  'document.upload': 'Unggah dokumen',
  'report.export': 'Ekspor laporan',
  'search.export': 'Ekspor hasil pencarian',
  'import.completed': 'Impor selesai',
  'import.completed_with_errors': 'Impor selesai dengan kesalahan',
  'import.failed': 'Impor gagal',
  'import.cancelled': 'Impor dibatalkan',
  'backup.export': 'Membuat cadangan',
  'backup.restore': 'Memulihkan data',
  'user.create': 'Membuat pengguna',
  'user.reset_password': 'Mengatur ulang kata sandi',
  'user.delete': 'Menghapus pengguna',
}

export const ENTITY_LABELS: Record<string, string> = {
  applications: 'Permohonan',
  applicants: 'Pemohon',
  companies: 'Badan usaha',
  permits: 'Izin terbit',
  permit_types: 'Jenis izin',
  archive_documents: 'Dokumen',
  classifications: 'Klasifikasi',
  profiles: 'Pengguna',
  roles: 'Peran',
  system_settings: 'Pengaturan',
  import_batches: 'Impor',
  system: 'Sistem',
}
