export type RoleCode = 'super_admin' | 'admin_arsip' | 'operator' | 'pimpinan'
export type AccessLevel = 'biasa' | 'terbatas' | 'rahasia'
export type DataSource = 'manual' | 'import'
export type DocumentCategory =
  | 'surat_permohonan'
  | 'identitas_pemohon'
  | 'dokumen_persyaratan'
  | 'rekomendasi_teknis'
  | 'berita_acara'
  | 'surat_keputusan'
  | 'dokumen_pendukung'

export interface Role {
  id: string
  code: RoleCode
  name: string
  description: string | null
  permissions: Record<string, boolean>
  is_system: boolean
}

export interface Profile {
  id: string
  email: string
  full_name: string
  nip: string | null
  position: string | null
  phone: string | null
  role_id: string
  is_active: boolean
  last_login_at: string | null
  created_at: string
  updated_at: string
  role?: Role
}

interface Tracked {
  data_source: DataSource
  is_manually_edited: boolean
  manually_edited_fields: string[]
  manually_edited_at: string | null
  last_import_batch_id: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface Applicant extends Tracked {
  id: string
  nik: string | null
  full_name: string
  phone: string | null
  email: string | null
  address: string | null
}

export interface Company extends Tracked {
  id: string
  name: string
  business_form: string | null
  nib: string | null
  npwp: string | null
  sector: string | null
  address: string | null
  phone: string | null
  email: string | null
  applicant_id: string | null
  applicant?: Pick<Applicant, 'id' | 'full_name'> | null
}

export interface Classification {
  id: string
  code: string
  name: string
  description: string | null
  parent_id: string | null
  retention_active_years: number
  retention_inactive_years: number
  final_disposition: 'musnah' | 'permanen' | 'dinilai_kembali'
  security_level: AccessLevel
  is_active: boolean
  created_at: string
}

export interface PermitType {
  id: string
  name: string
  code: string | null
  sector: string
  classification_id: string | null
  validity_years: number | null
  required_documents: DocumentCategory[]
  description: string | null
  is_active: boolean
  source_name: string | null
  report_group: string | null
  report_order: number
  created_at: string
  classification?: Pick<Classification, 'id' | 'code' | 'name'> | null
}

export interface Application extends Tracked {
  id: string
  source_system: string
  source_id: string | null
  application_number: string
  applicant_id: string
  company_id: string | null
  permit_type_id: string
  application_type: string
  application_date: string
  location: string | null
  permit_location: string | null
  status: 'proses' | 'terbit' | 'ditolak' | 'dibatalkan'
  classification_id: string | null
  archive_code: string | null
  physical_location: string | null
  access_level: AccessLevel
  notes: string | null
  source_data: Record<string, unknown> | null
}

export interface Permit extends Tracked {
  id: string
  application_id: string
  permit_number: string
  issued_date: string | null
  valid_until: string | null
  status: 'aktif' | 'dicabut' | 'kedaluwarsa' | 'dibekukan'
  signed_by: string | null
  notes: string | null
  renewal_notified_at: string | null
  renewal_note: string | null
}

export interface PermitExpiryRow {
  permit_id: string
  permit_number: string
  issued_date: string | null
  valid_until: string
  permit_status: Permit['status']
  days_left: number
  renewal_notified_at: string | null
  renewal_note: string | null
  renewal_notified_by_name: string | null
  application_id: string
  application_number: string
  application_type: string
  permit_location: string | null
  access_level: AccessLevel
  applicant_id: string
  applicant_name: string
  applicant_phone: string | null
  applicant_email: string | null
  company_name: string | null
  permit_type_id: string
  permit_type_name: string
  sector: string
  renewal_application_id: string | null
  renewal_application_number: string | null
  is_renewed: boolean
}

export interface ExpirySummary {
  thresholds: number[]
  today: string
  expired: number
  buckets: { months: number; count: number }[]
  not_notified: number
  without_validity: number
  nearest: { permit_id: string; application_id: string; permit_number: string; permit_type_name: string; applicant_name: string; valid_until: string; days_left: number; renewal_notified_at: string | null }[]
}

export interface ArchiveRow {
  id: string
  source_system: string
  source_id: string | null
  application_number: string
  application_type: string
  application_date: string
  application_year: number
  status: Application['status']
  location: string | null
  permit_location: string | null
  archive_code: string | null
  physical_location: string | null
  access_level: AccessLevel
  notes: string | null
  data_source: DataSource
  is_manually_edited: boolean
  last_import_batch_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  applicant_id: string
  applicant_name: string
  applicant_nik: string | null
  applicant_phone: string | null
  applicant_email: string | null
  company_id: string | null
  company_name: string | null
  permit_type_id: string
  permit_type_name: string
  sector: string
  classification_id: string | null
  classification_code: string | null
  classification_name: string | null
  permit_id: string | null
  permit_number: string | null
  issued_date: string | null
  valid_until: string | null
  permit_status: Permit['status'] | null
  document_count: number
  document_categories: DocumentCategory[]
  required_documents: DocumentCategory[]
  missing_documents: DocumentCategory[]
  is_complete: boolean
}

export interface ArchiveDocument {
  id: string
  application_id: string
  permit_id: string | null
  category: DocumentCategory
  title: string
  description: string | null
  document_number: string | null
  document_date: string | null
  storage_bucket: string
  storage_path: string
  file_name: string
  file_size: number
  mime_type: string
  checksum_sha256: string | null
  page_count: number | null
  document_group_id: string
  version: number
  is_latest: boolean
  change_note: string | null
  access_level: AccessLevel
  uploaded_by: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface DocumentRow extends ArchiveDocument {
  application_number: string
  application_date: string
  applicant_name: string
  permit_type_name: string
  permit_number: string | null
  uploaded_by_name: string | null
}

export type ImportStatus = 'draft' | 'processing' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled'

export interface ImportBatch {
  id: string
  file_name: string
  file_size: number | null
  file_hash: string | null
  sheet_name: string | null
  source_system: string
  match_key: 'source_id' | 'application_number'
  column_mapping: Record<string, string>
  options: Record<string, unknown>
  total_rows: number
  inserted_count: number
  updated_count: number
  unchanged_count: number
  skipped_count: number
  failed_count: number
  warning_count: number
  status: ImportStatus
  notes: string | null
  started_at: string | null
  finished_at: string | null
  imported_by: string | null
  created_at: string
  importer?: { full_name: string; email: string } | null
}

export interface ImportError {
  id: string
  batch_id: string
  row_number: number | null
  source_id: string | null
  application_number: string | null
  severity: 'error' | 'warning'
  error_type: 'validation' | 'duplicate_in_file' | 'conflict' | 'manual_protected' | 'skipped' | 'database'
  field: string | null
  message: string
  raw_data: unknown
  created_at: string
}

export interface ActivityLog {
  id: string
  user_id: string | null
  user_email: string | null
  user_role: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  description: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface SystemSetting {
  id: string
  key: string
  value: unknown
  description: string | null
  is_public: boolean
  updated_at: string
}

export interface DashboardStats {
  year: number | null
  totals: {
    applications: number
    permits: number
    documents: number
    documents_size: number
    applicants: number
    companies: number
    permit_types: number
    incomplete: number
    in_process: number
  }
  per_year: { year: number; applications: number; permits: number; documents: number }[]
  per_month: { month: string; applications: number; permits: number }[]
  per_permit_type: { name: string; count: number }[]
  per_sector: { sector: string; count: number }[]
  per_application_type: { type: string; count: number }[]
  per_category: { category: DocumentCategory; count: number }[]
  recent_imports: (Pick<ImportBatch, 'id' | 'file_name' | 'status' | 'total_rows' | 'inserted_count' | 'updated_count' | 'unchanged_count' | 'skipped_count' | 'failed_count' | 'created_at' | 'finished_at'> & { imported_by_name: string | null })[]
  recent_activity: { id: string; action: string; entity_type: string | null; description: string | null; created_at: string; user_email: string | null; user_name: string | null }[]
}
