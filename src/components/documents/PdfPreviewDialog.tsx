import { useEffect, useState } from 'react'
import { Document, Page } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import { ChevronLeft, ChevronRight, Download, Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import '@/lib/pdfWorker'
import { getSignedUrl } from '@/lib/documents'
import { errorMessage } from '@/lib/errors'
import { formatBytes, formatDate } from '@/lib/format'
import { categoryLabel } from '@/lib/constants'
import { useSettings } from '@/hooks/useSettings'
import { useAuth } from '@/hooks/useAuth'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ErrorState, FullPageLoader } from '@/components/common/States'
import { AccessBadge } from '@/components/common/Badges'
import type { ArchiveDocument } from '@/types'

export function useCanDownload() {
  const { role } = useAuth()
  const { data } = useSettings()
  return Boolean(role && (data?.downloadRoles ?? ['super_admin', 'admin_arsip', 'pimpinan']).includes(role))
}

export async function downloadDocument(doc: ArchiveDocument, ttl: number) {
  try {
    const url = await getSignedUrl(doc, ttl, true)
    const a = document.createElement('a')
    a.href = url
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } catch (e) {
    toast.error(errorMessage(e))
  }
}

export function PdfPreviewDialog({ doc, onOpenChange }: { doc: ArchiveDocument | null; onOpenChange: (o: boolean) => void }) {
  const { data: settings } = useSettings()
  const canDownload = useCanDownload()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [pages, setPages] = useState(0)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1.1)
  const ttl = settings?.signedUrlTtl ?? 300

  useEffect(() => {
    setUrl(null); setError(null); setPage(1); setPages(0)
    if (!doc) return
    let alive = true
    getSignedUrl(doc, ttl).then((u) => alive && setUrl(u)).catch((e) => alive && setError(e))
    return () => { alive = false }
  }, [doc, ttl])

  return (
    <Dialog open={!!doc} onOpenChange={onOpenChange}>
      <DialogContent size="full" className="h-[94vh]">
        {doc && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">{doc.title} <span className="text-sm font-normal text-muted-foreground">v{doc.version}</span> <AccessBadge level={doc.access_level} /></DialogTitle>
              <DialogDescription>
                {categoryLabel(doc.category)} · {doc.file_name} · {formatBytes(doc.file_size)}
                {doc.document_number ? ` · No. ${doc.document_number}` : ''}{doc.document_date ? ` · ${formatDate(doc.document_date)}` : ''}
              </DialogDescription>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button variant="outline" size="icon-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Halaman sebelumnya"><ChevronLeft /></Button>
                <span className="text-sm tabular">Halaman {page} / {pages || '…'}</span>
                <Button variant="outline" size="icon-sm" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} aria-label="Halaman berikutnya"><ChevronRight /></Button>
                <span className="mx-2 h-5 w-px bg-border" />
                <Button variant="outline" size="icon-sm" onClick={() => setScale((s) => Math.max(0.5, s - 0.15))} aria-label="Perkecil"><Minus /></Button>
                <span className="w-12 text-center text-sm tabular">{Math.round(scale * 100)}%</span>
                <Button variant="outline" size="icon-sm" onClick={() => setScale((s) => Math.min(3, s + 0.15))} aria-label="Perbesar"><Plus /></Button>
                {canDownload && (
                  <Button size="sm" variant="secondary" className="ml-auto" onClick={() => downloadDocument(doc, ttl)}><Download /> Unduh</Button>
                )}
              </div>
            </DialogHeader>
            <DialogBody className="bg-[#e9eef5] p-4" onContextMenu={(e) => !canDownload && e.preventDefault()}>
              {error ? <ErrorState error={error} /> : !url ? <FullPageLoader label="Menyiapkan dokumen…" /> : (
                <Document
                  file={url}
                  onLoadSuccess={(d) => setPages(d.numPages)}
                  onLoadError={(e) => setError(e)}
                  loading={<FullPageLoader label="Memuat PDF…" />}
                  error={<ErrorState error="Dokumen tidak dapat ditampilkan. Tautan mungkin kedaluwarsa; tutup dan buka kembali." />}
                >
                  <Page pageNumber={page} scale={scale} renderTextLayer renderAnnotationLayer={false} />
                </Document>
              )}
            </DialogBody>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
