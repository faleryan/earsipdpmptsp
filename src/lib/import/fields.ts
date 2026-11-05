export type TargetField =
  | 'source_id' | 'application_number' | 'permit_type_name' | 'application_type' | 'application_date'
  | 'applicant_name' | 'applicant_nik' | 'applicant_phone' | 'applicant_email' | 'applicant_address'
  | 'location' | 'permit_location' | 'permit_number' | 'issued_date' | 'valid_until'
  | 'company_name' | 'company_form' | 'company_nib' | 'company_npwp' | 'company_address' | 'sector'

export interface FieldDef {
  key: TargetField
  label: string
  group: 'Permohonan' | 'Pemohon' | 'Izin terbit' | 'Badan usaha'
  required?: boolean
  date?: boolean
  hint?: string
  synonyms: string[]
}

export const TARGET_FIELDS: FieldDef[] = [
  { key: 'source_id', label: 'ID SiCANTIK', group: 'Permohonan', hint: 'Kunci unik dari SiCANTIK; sangat disarankan untuk deteksi duplikat & perubahan',
    synonyms: ['id', 'idpermohonan', 'idsicantik', 'permohonanid', 'iddata'] },
  { key: 'application_number', label: 'Nomor permohonan', group: 'Permohonan', required: true,
    synonyms: ['nopermohonan', 'nomorpermohonan', 'noregistrasi', 'nomorregistrasi', 'noresi', 'nomorresi', 'noreg'] },
  { key: 'permit_type_name', label: 'Jenis izin', group: 'Permohonan', required: true,
    synonyms: ['izin', 'jenisizin', 'namaizin', 'jenisperizinan', 'perizinan', 'namaperizinan', 'layanan'] },
  { key: 'application_type', label: 'Jenis permohonan', group: 'Permohonan', hint: 'Baru / Perpanjangan / Perubahan / Pencabutan',
    synonyms: ['jenis', 'jenispermohonan', 'tipepermohonan', 'tipe'] },
  { key: 'application_date', label: 'Tanggal permohonan', group: 'Permohonan', required: true, date: true,
    synonyms: ['tanggal', 'tanggalpermohonan', 'tglpermohonan', 'tanggaldaftar', 'tanggalpengajuan', 'tglpengajuan'] },
  { key: 'location', label: 'Lokasi', group: 'Permohonan', synonyms: ['lokasi', 'lokasiusaha', 'tempatpraktik', 'lokasikegiatan'] },
  { key: 'permit_location', label: 'Lokasi izin', group: 'Permohonan', synonyms: ['lokasiizin'] },
  { key: 'sector', label: 'Sektor', group: 'Permohonan', hint: 'Opsional; jika kosong, sektor ditentukan dari nama jenis izin', synonyms: ['sektor', 'bidang'] },
  { key: 'applicant_name', label: 'Nama pemohon', group: 'Pemohon', required: true, synonyms: ['pemohon', 'namapemohon', 'nama'] },
  { key: 'applicant_nik', label: 'NIK / No. KTP', group: 'Pemohon', synonyms: ['noktp', 'nik', 'nomorktp', 'noidentitas', 'nomoridentitas', 'nikpemohon'] },
  { key: 'applicant_phone', label: 'No. HP / telepon', group: 'Pemohon', synonyms: ['nohptelp', 'nohp', 'notelp', 'telepon', 'hp', 'nomorhp', 'notelepon'] },
  { key: 'applicant_email', label: 'Email', group: 'Pemohon', synonyms: ['email', 'surel', 'emailpemohon'] },
  { key: 'applicant_address', label: 'Alamat pemohon', group: 'Pemohon', synonyms: ['alamat', 'alamatpemohon'] },
  { key: 'permit_number', label: 'Nomor izin', group: 'Izin terbit', synonyms: ['nomorizin', 'noizin', 'nosk', 'nomorsk'] },
  { key: 'issued_date', label: 'Tanggal penetapan', group: 'Izin terbit', date: true,
    synonyms: ['tanggalpenetapan', 'tglpenetapan', 'tanggalterbit', 'tanggalizin', 'tanggalsk', 'tglterbit'] },
  { key: 'valid_until', label: 'Berlaku sampai', group: 'Izin terbit', date: true,
    synonyms: ['berlakusampai', 'masaberlaku', 'tanggalberakhir', 'tanggalkadaluarsa', 'tanggalkedaluwarsa', 'berlakuhingga'] },
  { key: 'company_name', label: 'Nama badan usaha', group: 'Badan usaha', synonyms: ['namabadanusaha', 'namaperusahaan', 'badanusaha', 'perusahaan', 'namausaha'] },
  { key: 'company_form', label: 'Bentuk usaha', group: 'Badan usaha', synonyms: ['bentukusaha', 'bentukbadanusaha'] },
  { key: 'company_nib', label: 'NIB', group: 'Badan usaha', synonyms: ['nib'] },
  { key: 'company_npwp', label: 'NPWP', group: 'Badan usaha', synonyms: ['npwp'] },
  { key: 'company_address', label: 'Alamat badan usaha', group: 'Badan usaha', synonyms: ['alamatusaha', 'alamatperusahaan', 'alamatbadanusaha'] },
]

export const fieldLabel = (k: string) => TARGET_FIELDS.find((f) => f.key === k)?.label ?? k

export type Mapping = Partial<Record<TargetField, string>>

const normalizeHeader = (h: string) => h.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')

/** Pemetaan otomatis: hanya kecocokan persis (setelah normalisasi) agar tidak salah petakan. */
export function autoMap(headers: string[]): Mapping {
  const mapping: Mapping = {}
  const used = new Set<string>()
  const norm = headers.map((h) => ({ h, n: normalizeHeader(h) }))
  for (const f of TARGET_FIELDS) {
    const hit = norm.find((x) => !used.has(x.h) && f.synonyms.includes(x.n))
    if (hit) {
      mapping[f.key] = hit.h
      used.add(hit.h)
    }
  }
  return mapping
}

export function requiredFields(matchKey: 'source_id' | 'application_number'): TargetField[] {
  const req = TARGET_FIELDS.filter((f) => f.required).map((f) => f.key)
  return matchKey === 'source_id' ? ['source_id', ...req] : req
}
