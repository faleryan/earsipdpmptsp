import { supabase, DOCUMENT_BUCKET } from './supabase'
import type { FileCheck } from './documents'
import type { AccessLevel, OssDocument } from '@/types'

/** Tebak kategori dokumen OSS dari nama file / nama dokumen izin / teks PDF. */
export function guessOssCategory(text: string): string {
  const t = text.toLowerCase()
  if (/pkkpr|kesesuaian kegiatan pemanfaatan ruang/.test(t)) return 'pkkpr'
  if (/sppl|kesanggupan pengelolaan/.test(t)) return 'sppl'
  if (/pernyataan mandiri/.test(t)) return 'pernyataan_mandiri'
  if (/ukl[\s-]*upl|amdal|persetujuan lingkungan/.test(t)) return 'persetujuan_lingkungan'
  if (/sertifikat standar|\bss\b/.test(t)) return 'sertifikat_standar'
  if (/\bnib\b|nomor induk berusaha/.test(t)) return 'nib'
  if (/\bizin\b/.test(t)) return 'izin'
  return 'dokumen_pendukung'
}

/** Ambil teks dari beberapa halaman pertama PDF (untuk mencari NIB). */
export async function extractPdfText(file: File, maxPages = 2): Promise<string> {
  try {
    const { pdfjs } = await import('./pdfWorker')
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    const parts: string[] = []
    for (let i = 1; i <= Math.min(maxPages, doc.numPages); i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      parts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '))
    }
    await doc.destroy()
    return parts.join('\n')
  } catch {
    return ''
  }
}

/**
 * Cari NIB yang dikenal: pertama dari nama file, lalu dari teks PDF.
 * Angka 13 digit (boleh dipisah spasi/titik) dicocokkan ke daftar NIB hasil impor OSS.
 */
export function findNib(fileName: string, text: string, known: Set<string>): { nib: string | null; source: 'nama file' | 'isi PDF' | null } {
  const scan = (s: string) => {
    const compact = s.replace(/(\d)[\s.-](?=\d)/g, '$1')
    for (const m of compact.matchAll(/(?<!\d)(\d{13})(?!\d)/g)) if (known.has(m[1])) return m[1]
    return null
  }
  const fromName = scan(fileName)
  if (fromName) return { nib: fromName, source: 'nama file' }
  const fromText = scan(text)
  if (fromText) return { nib: fromText, source: 'isi PDF' }
  return { nib: null, source: null }
}

export interface OssUploadInput {
  file: File
  nib: string
  permitId?: string | null
  category: string
  title: string
  documentNumber?: string
  documentDate?: string
  accessLevel: AccessLevel
  documentGroupId?: string
  changeNote?: string
}

export async function uploadOssDocument(input: OssUploadInput, check: FileCheck) {
  const path = `oss/${input.nib}/${crypto.randomUUID()}.pdf`
  const up = await supabase.storage.from(DOCUMENT_BUCKET).upload(path, input.file, { contentType: 'application/pdf', upsert: false, cacheControl: '0' })
  if (up.error) throw up.error
  const { data, error } = await supabase.from('oss_documents').insert({
    nib: input.nib,
    oss_permit_id: input.permitId ?? null,
    category: input.category,
    title: input.title,
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
  }).select().single()
  if (error) {
    await supabase.storage.from(DOCUMENT_BUCKET).remove([path])
    throw error
  }
  return data as OssDocument
}

/** Dokumen NIB terbaru per NIB (untuk unggah massal: lewati / versi baru) */
export async function latestNibDocuments(nibs: string[]) {
  const map = new Map<string, OssDocument>()
  for (let i = 0; i < nibs.length; i += 200) {
    const { data, error } = await supabase.from('oss_documents').select('*')
      .in('nib', nibs.slice(i, i + 200)).eq('category', 'nib').eq('is_latest', true).is('deleted_at', null)
    if (error) throw error
    ;(data as OssDocument[]).forEach((d) => map.set(d.nib, d))
  }
  return map
}

export const asPreview = (d: OssDocument) => ({ ...d, entity: 'oss_documents' as const })
