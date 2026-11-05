import { supabase, DOCUMENT_BUCKET } from './supabase'
import { sha256Hex } from './utils'
import { logActivity } from './activity'
import type { AccessLevel, ArchiveDocument, DocumentCategory } from '@/types'

export interface UploadInput {
  file: File
  applicationId: string
  permitId?: string | null
  category: DocumentCategory
  title: string
  description?: string
  documentNumber?: string
  documentDate?: string
  accessLevel: AccessLevel
  /** Isi untuk mengunggah versi baru dari dokumen yang ada */
  documentGroupId?: string
  changeNote?: string
}

export interface FileCheck {
  ok: boolean
  message?: string
  checksum?: string
  pageCount?: number
}

/** Validasi tipe (magic bytes %PDF-), ukuran, dan hitung checksum + jumlah halaman. */
export async function inspectPdf(file: File, maxMb: number): Promise<FileCheck> {
  if (file.size === 0) return { ok: false, message: 'File kosong.' }
  if (file.size > maxMb * 1024 * 1024) return { ok: false, message: `Ukuran melebihi ${maxMb} MB.` }
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return { ok: false, message: 'Hanya file PDF yang diizinkan.' }
  const buf = await file.arrayBuffer()
  const head = new TextDecoder('ascii').decode(buf.slice(0, 1024))
  if (!head.includes('%PDF-')) return { ok: false, message: 'Isi file bukan PDF yang valid.' }
  const checksum = await sha256Hex(buf)
  let pageCount: number | undefined
  try {
    const { pdfjs } = await import('./pdfWorker')
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
    pageCount = doc.numPages
    await doc.destroy()
  } catch (e) {
    const name = (e as Error)?.name
    if (name === 'PasswordException') return { ok: false, message: 'PDF terkunci kata sandi. Unggah versi tanpa kata sandi.' }
    return { ok: false, message: 'PDF rusak atau tidak dapat dibaca.' }
  }
  return { ok: true, checksum, pageCount }
}

export async function uploadDocument(input: UploadInput, check: FileCheck) {
  const path = `permohonan/${input.applicationId}/${crypto.randomUUID()}.pdf`
  const up = await supabase.storage.from(DOCUMENT_BUCKET).upload(path, input.file, {
    contentType: 'application/pdf',
    upsert: false,
    cacheControl: '0',
  })
  if (up.error) throw up.error

  const { data, error } = await supabase
    .from('archive_documents')
    .insert({
      application_id: input.applicationId,
      permit_id: input.permitId ?? null,
      category: input.category,
      title: input.title,
      description: input.description || null,
      document_number: input.documentNumber || null,
      document_date: input.documentDate || null,
      storage_path: path,
      file_name: input.file.name.slice(0, 255),
      file_size: input.file.size,
      mime_type: 'application/pdf',
      checksum_sha256: check.checksum ?? null,
      page_count: check.pageCount ?? null,
      access_level: input.accessLevel,
      document_group_id: input.documentGroupId ?? null,
      change_note: input.changeNote || null,
    })
    .select()
    .single()

  if (error) {
    // bersihkan file yatim agar storage tidak menumpuk
    await supabase.storage.from(DOCUMENT_BUCKET).remove([path])
    throw error
  }
  return data as ArchiveDocument
}

export async function getSignedUrl(doc: Pick<ArchiveDocument, 'id' | 'storage_path' | 'file_name' | 'title'>, ttl: number, download = false) {
  const { data, error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(doc.storage_path, ttl, download ? { download: doc.file_name } : undefined)
  if (error) throw error
  void logActivity(download ? 'document.download' : 'document.preview', 'archive_documents', doc.id,
    `${download ? 'Mengunduh' : 'Melihat'} dokumen "${doc.title}"`)
  return data.signedUrl
}

export async function findDuplicateChecksum(applicationId: string, checksum: string) {
  const { data } = await supabase
    .from('archive_documents')
    .select('id, title, version')
    .eq('application_id', applicationId)
    .eq('checksum_sha256', checksum)
    .is('deleted_at', null)
    .limit(1)
  return data?.[0] ?? null
}
