import type { ExportColumn } from '@/lib/export'
import { APPLICATION_STATUS, PERMIT_STATUS, categoryShort } from '@/lib/constants'
import { formatDate, maskNik } from '@/lib/format'
import type { ArchiveRow } from '@/types'

export function archiveExportColumns(revealNik: boolean): ExportColumn<ArchiveRow>[] {
  return [
    { header: 'No. Permohonan', value: (r) => r.application_number, width: 34 },
    { header: 'ID SiCANTIK', value: (r) => r.source_id, width: 12 },
    { header: 'Tanggal', value: (r) => formatDate(r.application_date, 'dd/MM/yyyy'), width: 11 },
    { header: 'Jenis Izin', value: (r) => r.permit_type_name, width: 45 },
    { header: 'Jenis', value: (r) => r.application_type, width: 12 },
    { header: 'Pemohon', value: (r) => r.applicant_name, width: 30 },
    { header: 'NIK', value: (r) => maskNik(r.applicant_nik, revealNik), width: 18 },
    { header: 'Badan Usaha', value: (r) => r.company_name, width: 25 },
    { header: 'Lokasi Izin', value: (r) => r.permit_location ?? r.location, width: 30 },
    { header: 'Nomor Izin', value: (r) => r.permit_number, width: 34 },
    { header: 'Tgl Penetapan', value: (r) => (r.issued_date ? formatDate(r.issued_date, 'dd/MM/yyyy') : ''), width: 12 },
    { header: 'Status', value: (r) => APPLICATION_STATUS[r.status]?.label ?? r.status, width: 12 },
    { header: 'Status Izin', value: (r) => (r.permit_status ? PERMIT_STATUS[r.permit_status]?.label : ''), width: 10 },
    { header: 'Klasifikasi', value: (r) => r.classification_code, width: 10 },
    { header: 'Sektor', value: (r) => r.sector, width: 12 },
    { header: 'Dokumen', value: (r) => r.document_count, width: 9 },
    { header: 'Kurang', value: (r) => r.missing_documents.map(categoryShort).join(', '), width: 30 },
    { header: 'Lokasi Fisik', value: (r) => r.physical_location, width: 14 },
  ]
}

/** Kolom ringkas untuk PDF lanskap A4 */
export function archivePdfColumns(revealNik: boolean): ExportColumn<ArchiveRow>[] {
  const all = archiveExportColumns(revealNik)
  const keep = ['No. Permohonan', 'Tanggal', 'Jenis Izin', 'Jenis', 'Pemohon', 'Nomor Izin', 'Tgl Penetapan', 'Status', 'Dokumen']
  return all.filter((c) => keep.includes(c.header))
}
