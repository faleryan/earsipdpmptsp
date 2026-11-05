interface PgLikeError {
  message?: string
  code?: string
  details?: string | null
  hint?: string | null
  status?: number
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  applicants_nik_key: 'NIK sudah terdaftar untuk pemohon lain.',
  companies_nib_key: 'NIB sudah terdaftar untuk badan usaha lain.',
  permits_number_key: 'Nomor izin sudah dipakai arsip lain.',
  permits_application_id_key: 'Permohonan ini sudah memiliki data izin terbit.',
  applications_source_key: 'ID SiCANTIK sudah tercatat pada arsip lain.',
  applications_archive_code_key: 'Kode arsip sudah dipakai arsip lain.',
  permit_types_name_key: 'Nama jenis izin sudah ada.',
  permit_types_code_key: 'Kode jenis izin sudah ada.',
  classifications_code_key: 'Kode klasifikasi sudah ada.',
  profiles_email_key: 'Email sudah dipakai pengguna lain.',
}

/** Ubah galat Supabase/PostgreSQL menjadi pesan bahasa Indonesia yang dapat ditindaklanjuti. */
export function errorMessage(err: unknown): string {
  if (!err) return 'Terjadi kesalahan yang tidak diketahui.'
  if (typeof err === 'string') return err
  const e = err as PgLikeError
  const msg = e.message ?? String(err)

  for (const [constraint, text] of Object.entries(CONSTRAINT_MESSAGES)) {
    if (msg.includes(constraint) || e.details?.includes(constraint)) return text
  }
  switch (e.code) {
    case '23505':
      return 'Data yang sama sudah ada. Periksa nomor atau kode yang dimasukkan.'
    case '23503':
      return msg.includes('delete') || msg.includes('update or delete')
        ? 'Data tidak dapat dihapus karena masih digunakan oleh data lain (misalnya permohonan atau dokumen).'
        : 'Data rujukan tidak ditemukan.'
    case '23514':
      return 'Nilai yang dimasukkan tidak memenuhi aturan validasi.'
    case '42501':
      return msg && !msg.startsWith('new row violates') && !msg.startsWith('permission denied')
        ? msg
        : 'Anda tidak memiliki hak akses untuk tindakan ini.'
    case 'PGRST301':
    case '401':
      return 'Sesi Anda berakhir. Silakan masuk kembali.'
    case 'P0001':
    case 'P0002':
    case '22023':
      return msg
  }
  if (msg.includes('row-level security')) return 'Anda tidak memiliki hak akses untuk tindakan ini.'
  if (msg === 'Failed to fetch' || msg.includes('NetworkError')) return 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.'
  if (msg.includes('Invalid login credentials')) return 'Email atau kata sandi salah.'
  if (msg.includes('Email not confirmed')) return 'Email belum dikonfirmasi. Periksa kotak masuk Anda.'
  if (msg.includes('The resource already exists')) return 'File dengan nama yang sama sudah ada di penyimpanan.'
  if (msg.includes('Payload too large') || msg.includes('exceeded the maximum allowed size')) return 'Ukuran file melebihi batas yang diizinkan.'
  return msg
}
