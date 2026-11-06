import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Download, Eye, FileText, History, MoreHorizontal, RotateCcw, Trash2, Upload } from 'lucide-react'
import { supabase, DOCUMENT_BUCKET } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { formatBytes, formatDate, formatDateTime } from '@/lib/format'
import { categoryLabel } from '@/lib/constants'
import { asPreview } from '@/lib/ossDocuments'
import { useAuth } from '@/hooks/useAuth'
import { useSettings } from '@/hooks/useSettings'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { AccessBadge } from '@/components/common/Badges'
import { ErrorState, LoadingRows } from '@/components/common/States'
import { PdfPreviewDialog, downloadDocument, useCanDownload, type PreviewDoc } from '@/components/documents/PdfPreviewDialog'
import { OssUploadDialog } from './OssUploadDialog'
import type { OssDocument, OssPermitRow } from '@/types'

export function useOssDocuments(nib: string, includeDeleted: boolean, allVersions = false) {
  return useQuery({
    queryKey: ['oss', 'documents', nib, includeDeleted, allVersions],
    queryFn: async () => {
      let q = supabase.from('v_oss_document_list').select('*').eq('nib', nib).order('created_at', { ascending: false })
      if (!allVersions) q = q.eq('is_latest', true)
      if (!includeDeleted) q = q.is('deleted_at', null)
      const { data, error } = await q
      if (error) throw error
      return data as OssDocument[]
    },
  })
}

export function OssDocumentsPanel({ nib, companyName, permits }: { nib: string; companyName: string; permits: OssPermitRow[] }) {
  const qc = useQueryClient()
  const { can, role, profile } = useAuth()
  const { data: settings } = useSettings()
  const canDownload = useCanDownload()
  const [showDeleted, setShowDeleted] = useState(false)
  const [allPermits, setAllPermits] = useState(false)
  const [historyOf, setHistoryOf] = useState<string | null>(null)
  const [upload, setUpload] = useState<{ category?: string; permitId?: string | null; versionOf?: OssDocument } | null>(null)
  const [preview, setPreview] = useState<PreviewDoc | null>(null)
  const [del, setDel] = useState<OssDocument | null>(null)
  const [purge, setPurge] = useState<OssDocument | null>(null)
  const docs = useOssDocuments(nib, showDeleted)
  const versions = useQuery({
    queryKey: ['oss', 'documents', 'versions', historyOf],
    enabled: !!historyOf,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_oss_document_list').select('*').eq('document_group_id', historyOf!).order('version', { ascending: false })
      if (error) throw error
      return data as OssDocument[]
    },
  })
  const ttl = settings?.signedUrlTtl ?? 300
  const canManage = (d: OssDocument) => can('documents.manage') || (can('documents.upload') && d.uploaded_by === profile?.id)
  const refresh = () => qc.invalidateQueries({ queryKey: ['oss'] })
  const nibDoc = docs.data?.find((d) => d.category === 'nib' && !d.deleted_at)
  const permitName = (id: string | null) => permits.find((p) => p.id === id)?.document_name

  const row = (d: OssDocument) => (
    <li key={d.id} className={`flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 ${d.deleted_at ? 'opacity-60' : ''}`}>
      <FileText className="size-5 shrink-0 text-primary" />
      <button className="min-w-0 flex-1 text-left" onClick={() => setPreview(asPreview(d))}>
        <p className="truncate text-sm font-medium hover:text-primary">{d.title} <span className="font-normal text-muted-foreground">v{d.version}</span></p>
        <p className="truncate text-xs text-muted-foreground">
          {[categoryLabel(d.category), d.oss_permit_id && `izin: ${permitName(d.oss_permit_id) ?? d.permit_document_name ?? '—'}`, d.document_number && `No. ${d.document_number}`,
            formatBytes(d.file_size), d.uploaded_by_name, formatDateTime(d.created_at)].filter(Boolean).join(' · ')}
        </p>
      </button>
      <AccessBadge level={d.access_level} />
      {d.deleted_at && <Badge variant="danger">Dihapus</Badge>}
      <Button variant="ghost" size="icon-sm" aria-label="Pratinjau" onClick={() => setPreview(asPreview(d))}><Eye /></Button>
      {canDownload && <Button variant="ghost" size="icon-sm" aria-label="Unduh" onClick={() => downloadDocument(asPreview(d), ttl)}><Download /></Button>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Aksi dokumen"><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setHistoryOf(d.document_group_id)}><History /> Riwayat versi</DropdownMenuItem>
          {canManage(d) && !d.deleted_at && <DropdownMenuItem onSelect={() => setUpload({ versionOf: d })}><Upload /> Unggah versi baru</DropdownMenuItem>}
          {can('documents.manage') && (
            <>
              <DropdownMenuSeparator />
              {d.deleted_at ? (
                <>
                  <DropdownMenuItem onSelect={async () => {
                    const { error } = await supabase.from('oss_documents').update({ deleted_at: null }).eq('document_group_id', d.document_group_id)
                    if (error) toast.error(errorMessage(error)); else { toast.success('Dokumen dipulihkan.'); refresh() }
                  }}><RotateCcw /> Pulihkan</DropdownMenuItem>
                  {role === 'super_admin' && <DropdownMenuItem className="text-destructive" onSelect={() => setPurge(d)}><Trash2 /> Hapus permanen</DropdownMenuItem>}
                </>
              ) : <DropdownMenuItem className="text-destructive" onSelect={() => setDel(d)}><Trash2 /> Hapus</DropdownMenuItem>}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )

  const general = docs.data?.filter((d) => !d.oss_permit_id) ?? []
  const byPermitAll = permits.map((p) => ({ permit: p, docs: docs.data?.filter((d) => d.oss_permit_id === p.id) ?? [] }))
  const withDocs = byPermitAll.filter((x) => x.docs.length)
  const byPermit = allPermits ? byPermitAll : withDocs

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Dokumen OSS</CardTitle>
          <CardDescription className="mt-1 flex items-center gap-2">
            {nibDoc ? <><CheckCircle2 className="size-4 text-success" /> File NIB tersimpan (v{nibDoc.version})</> : 'File NIB belum diunggah.'}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can('documents.manage') && <label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={showDeleted} onCheckedChange={setShowDeleted} /> Terhapus</label>}
          {can('documents.upload') && (
            <>
              {!nibDoc && <Button size="sm" onClick={() => setUpload({ category: 'nib' })}><Upload /> Unggah file NIB</Button>}
              <Button size="sm" variant="outline" onClick={() => setUpload({})}><Upload /> Dokumen lain</Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {docs.isLoading ? <LoadingRows rows={2} cols={3} /> : docs.error ? <ErrorState error={docs.error} /> : (
          <>
            <div>
              <p className="mb-2 text-sm font-semibold">Dokumen pelaku usaha</p>
              {general.length ? <ul className="space-y-2">{general.map(row)}</ul>
                : <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">Belum ada dokumen. Unggah file NIB dari OSS (PDF).</p>}
            </div>
            {permits.length > 0 && (
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Dokumen per izin OSS <span className="font-normal text-muted-foreground">({withDocs.length} dari {permits.length} izin memiliki PDF)</span></p>
                  {withDocs.length < permits.length && (
                    <Button size="sm" variant="ghost" onClick={() => setAllPermits((v) => !v)}>
                      {allPermits ? 'Hanya izin yang ada PDF' : can('documents.upload') ? `Tampilkan semua izin (${permits.length}) untuk unggah` : `Tampilkan semua izin (${permits.length})`}
                    </Button>
                  )}
                </div>
                {!byPermit.length && <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">Belum ada PDF izin (PKKPR, SPPL, Sertifikat Standar, dst.).</p>}
                <ul className="space-y-3">
                  {byPermit.map(({ permit, docs: list }) => (
                    <li key={permit.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{permit.document_name}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(permit.permit_date)} · {permit.permit_request_id} · {permit.permit_status}</p>
                        </div>
                        {can('documents.upload') && <Button size="sm" variant="ghost" onClick={() => setUpload({ permitId: permit.id })}><Upload /> Unggah</Button>}
                      </div>
                      {list.length > 0 && <ul className="mt-2 space-y-2">{list.map(row)}</ul>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        {historyOf && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold">Riwayat versi</p><Button size="sm" variant="ghost" onClick={() => setHistoryOf(null)}>Tutup</Button></div>
            {versions.data?.map((v) => (
              <div key={v.id} className="flex items-center gap-3 border-t py-2 text-sm first:border-0">
                <span className="w-8 font-bold text-primary tabular">v{v.version}</span>
                <span className="min-w-0 flex-1 truncate">{v.file_name} · {formatDateTime(v.created_at)} · {v.uploaded_by_name ?? '—'}{v.change_note ? ` · ${v.change_note}` : ''}</span>
                <Button size="icon-sm" variant="ghost" aria-label="Lihat versi" onClick={() => setPreview(asPreview(v))}><Eye /></Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {upload && (
        <OssUploadDialog open onOpenChange={(o) => !o && setUpload(null)} nib={nib} companyName={companyName} permits={permits}
          defaultCategory={upload.category} defaultPermitId={upload.permitId} versionOf={upload.versionOf} />
      )}
      <PdfPreviewDialog doc={preview} onOpenChange={(o) => !o && setPreview(null)} />
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Hapus dokumen?" destructive confirmLabel="Hapus dokumen"
        description={<>Dokumen <strong>{del?.title}</strong> (semua versi) dipindahkan ke daftar terhapus dan dapat dipulihkan Admin.</>}
        onConfirm={async () => {
          const { error } = await supabase.from('oss_documents').update({ deleted_at: new Date().toISOString() }).eq('document_group_id', del!.document_group_id).is('deleted_at', null)
          if (error) { toast.error(errorMessage(error)); throw error }
          toast.success('Dokumen dihapus.'); refresh()
        }} />
      <ConfirmDialog open={!!purge} onOpenChange={(o) => !o && setPurge(null)} title="Hapus permanen?" destructive confirmLabel="Hapus permanen"
        description={<>File <strong>{purge?.title}</strong> beserta seluruh versinya dihapus dari penyimpanan dan tidak dapat dipulihkan.</>}
        onConfirm={async () => {
          const { data: group, error: ge } = await supabase.from('oss_documents').select('storage_path').eq('document_group_id', purge!.document_group_id)
          if (ge) { toast.error(errorMessage(ge)); throw ge }
          const { error } = await supabase.from('oss_documents').delete().eq('document_group_id', purge!.document_group_id)
          if (error) { toast.error(errorMessage(error)); throw error }
          const rm = await supabase.storage.from(DOCUMENT_BUCKET).remove(group.map((g) => g.storage_path))
          if (rm.error) toast.warning(`Catatan dihapus, file gagal dihapus dari storage: ${errorMessage(rm.error)}`); else toast.success('Dokumen dihapus permanen.')
          refresh()
        }} />
    </Card>
  )
}
