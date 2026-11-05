import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Eye } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { formatBytes, formatDateTime } from '@/lib/format'
import { ACCESS_LEVELS, DOCUMENT_CATEGORIES } from '@/lib/constants'
import { useAuth } from '@/hooks/useAuth'
import { useSettings } from '@/hooks/useSettings'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { FormField } from '@/components/common/FormField'
import { ErrorState, LoadingRows } from '@/components/common/States'
import { downloadDocument, useCanDownload } from './PdfPreviewDialog'
import type { ArchiveDocument } from '@/types'

type Versioned = ArchiveDocument & { uploader: { full_name: string } | null }

export function DocumentVersionsDialog({ doc, onOpenChange, onPreview }: { doc: ArchiveDocument | null; onOpenChange: (o: boolean) => void; onPreview: (d: ArchiveDocument) => void }) {
  const canDownload = useCanDownload()
  const { data: settings } = useSettings()
  const q = useQuery({
    queryKey: ['documents', 'versions', doc?.document_group_id],
    enabled: !!doc,
    queryFn: async () => {
      const { data, error } = await supabase.from('archive_documents')
        .select('*, uploader:profiles!archive_documents_uploaded_by_fkey(full_name)')
        .eq('document_group_id', doc!.document_group_id).order('version', { ascending: false })
      if (error) throw error
      return data as Versioned[]
    },
  })
  return (
    <Dialog open={!!doc} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Riwayat versi</DialogTitle>
          <DialogDescription>{doc?.title}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {q.isLoading ? <LoadingRows rows={3} cols={3} /> : q.error ? <ErrorState error={q.error} /> : (
            <ol className="space-y-2">
              {q.data?.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                  <span className="flex size-9 items-center justify-center rounded-md bg-accent text-sm font-bold text-primary tabular">v{v.version}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {v.file_name} {v.is_latest && !v.deleted_at && <Badge variant="success" className="ml-1">Terbaru</Badge>}
                      {v.deleted_at && <Badge variant="danger" className="ml-1">Dihapus</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(v.created_at)} · {v.uploader?.full_name ?? '—'} · {formatBytes(v.file_size)}</p>
                    {v.change_note && <p className="mt-1 text-xs">Alasan: {v.change_note}</p>}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => onPreview(v)}><Eye /> Lihat</Button>
                  {canDownload && <Button variant="ghost" size="icon-sm" aria-label="Unduh" onClick={() => downloadDocument(v, settings?.signedUrlTtl ?? 300)}><Download /></Button>}
                </li>
              ))}
            </ol>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

interface EditValues {
  title: string
  category: string
  document_number: string
  document_date: string
  description: string
  access_level: string
}

export function DocumentEditDialog({ doc, onOpenChange }: { doc: ArchiveDocument | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const form = useForm<EditValues>({
    values: {
      title: doc?.title ?? '', category: doc?.category ?? 'dokumen_pendukung', document_number: doc?.document_number ?? '',
      document_date: doc?.document_date ?? '', description: doc?.description ?? '', access_level: doc?.access_level ?? 'biasa',
    },
  })
  const m = useMutation({
    mutationFn: async (v: EditValues) => {
      if (v.title.trim().length < 2) throw new Error('Judul minimal 2 karakter.')
      const { error } = await supabase.from('archive_documents').update({
        title: v.title.trim(), category: v.category, document_number: v.document_number || null,
        document_date: v.document_date || null, description: v.description || null, access_level: v.access_level,
      }).eq('id', doc!.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Metadata dokumen disimpan.')
      qc.invalidateQueries({ queryKey: ['documents'] })
      qc.invalidateQueries({ queryKey: ['application'] })
      onOpenChange(false)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open={!!doc} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="flex min-h-0 flex-col">
          <DialogHeader><DialogTitle>Ubah metadata dokumen</DialogTitle><DialogDescription>File PDF tidak berubah. Untuk mengganti file, unggah versi baru.</DialogDescription></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <FormField label="Judul" htmlFor="de-title" required className="sm:col-span-2"><Input id="de-title" {...form.register('title')} /></FormField>
            <FormField label="Kategori" htmlFor="de-cat">
              <NativeSelect id="de-cat" {...form.register('category')}>{DOCUMENT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</NativeSelect>
            </FormField>
            <FormField label="Tingkat akses" htmlFor="de-acc">
              <NativeSelect id="de-acc" {...form.register('access_level')}>
                {ACCESS_LEVELS.filter((a) => a.value !== 'rahasia' || can('documents.secret')).map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </NativeSelect>
            </FormField>
            <FormField label="Nomor dokumen" htmlFor="de-no"><Input id="de-no" {...form.register('document_number')} /></FormField>
            <FormField label="Tanggal dokumen" htmlFor="de-date"><Input id="de-date" type="date" {...form.register('document_date')} /></FormField>
            <FormField label="Keterangan" htmlFor="de-desc" className="sm:col-span-2"><Textarea id="de-desc" rows={2} {...form.register('description')} /></FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
            <Button type="submit" loading={m.isPending}>Simpan</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
