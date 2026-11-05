import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Eye, FileText, FolderOpen, Trash2 } from 'lucide-react'
import { supabase, DOCUMENT_BUCKET } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { likePattern, pgrstQuote } from '@/lib/utils'
import { formatBytes, formatDateTime } from '@/lib/format'
import { ACCESS_LEVELS, DOCUMENT_CATEGORIES, categoryLabel } from '@/lib/constants'
import { useAuth } from '@/hooks/useAuth'
import { useSettings } from '@/hooks/useSettings'
import { useDebounce } from '@/hooks/useDebounce'
import { usePagedList } from '@/hooks/usePagedList'
import { PageHeader } from '@/components/common/PageHeader'
import { DataTable, Pagination, type Column } from '@/components/common/DataTable'
import { SearchInput } from '@/components/common/SearchInput'
import { AccessBadge } from '@/components/common/Badges'
import { EmptyState } from '@/components/common/States'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { PdfPreviewDialog, downloadDocument, useCanDownload } from '@/components/documents/PdfPreviewDialog'
import type { DocumentRow } from '@/types'

export default function DocumentsPage() {
  const { can, role } = useAuth()
  const { data: settings } = useSettings()
  const canDownload = useCanDownload()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const q = useDebounce(search)
  const category = params.get('category') ?? ''
  const access = params.get('access') ?? ''
  const scope = params.get('scope') ?? 'latest'
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const [preview, setPreview] = useState<DocumentRow | null>(null)
  const [purge, setPurge] = useState<DocumentRow | null>(null)
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  const list = usePagedList<DocumentRow>({
    queryKey: ['documents', 'list', q, category, access, scope, from, to],
    defaultSort: { column: 'created_at', ascending: false },
    build: () => {
      let query = supabase.from('v_document_list').select('*', { count: 'exact' })
      if (scope === 'latest') query = query.eq('is_latest', true).is('deleted_at', null)
      if (scope === 'deleted') query = query.not('deleted_at', 'is', null)
      if (scope === 'all') query = query.is('deleted_at', null)
      if (category) query = query.eq('category', category)
      if (access) query = query.eq('access_level', access)
      if (from) query = query.gte('created_at', from)
      if (to) query = query.lte('created_at', `${to}T23:59:59`)
      if (q.trim()) {
        const p = pgrstQuote(likePattern(q.trim()))
        query = query.or(`title.ilike.${p},file_name.ilike.${p},application_number.ilike.${p},applicant_name.ilike.${p},document_number.ilike.${p},permit_number.ilike.${p}`)
      }
      return query
    },
  })

  const columns: Column<DocumentRow>[] = [
    {
      key: 'title', header: 'Dokumen', sortable: true,
      cell: (r) => (
        <button className="flex min-w-60 items-start gap-2 text-left" onClick={() => setPreview(r)}>
          <FileText className="mt-0.5 size-5 shrink-0 text-primary" />
          <span>
            <span className="block font-medium hover:text-primary">{r.title} <span className="font-normal text-muted-foreground">v{r.version}</span></span>
            <span className="block text-xs text-muted-foreground">{r.file_name} · {formatBytes(r.file_size)}{r.page_count ? ` · ${r.page_count} hlm` : ''}</span>
          </span>
        </button>
      ),
    },
    { key: 'category', header: 'Kategori', sortable: true, cell: (r) => <span className="whitespace-nowrap text-sm">{categoryLabel(r.category)}</span> },
    {
      key: 'application_number', header: 'Berkas permohonan', sortable: true,
      cell: (r) => (
        <div className="min-w-52">
          <Link to={`/permohonan/${r.application_id}`} className="text-sm font-medium hover:text-primary hover:underline">{r.application_number}</Link>
          <p className="text-xs text-muted-foreground">{r.applicant_name}</p>
        </div>
      ),
    },
    { key: 'access_level', header: 'Akses', cell: (r) => <span className="flex gap-1"><AccessBadge level={r.access_level} />{r.access_level === 'biasa' && <span className="text-xs text-muted-foreground">Biasa</span>}{r.deleted_at && <Badge variant="danger">Dihapus</Badge>}{!r.is_latest && <Badge variant="muted">Versi lama</Badge>}</span> },
    { key: 'created_at', header: 'Diunggah', sortable: true, cell: (r) => <div className="whitespace-nowrap text-sm"><p className="tabular">{formatDateTime(r.created_at)}</p><p className="text-xs text-muted-foreground">{r.uploaded_by_name ?? '—'}</p></div> },
    {
      key: 'actions', header: <span className="sr-only">Aksi</span>, className: 'text-right whitespace-nowrap',
      cell: (r) => (
        <>
          <Button variant="ghost" size="icon-sm" aria-label="Pratinjau" onClick={() => setPreview(r)}><Eye /></Button>
          {canDownload && <Button variant="ghost" size="icon-sm" aria-label="Unduh" onClick={() => downloadDocument(r, settings?.signedUrlTtl ?? 300)}><Download /></Button>}
          <Button variant="ghost" size="icon-sm" aria-label="Buka berkas" asChild><Link to={`/permohonan/${r.application_id}`}><FolderOpen /></Link></Button>
          {role === 'super_admin' && r.deleted_at && <Button variant="ghost" size="icon-sm" aria-label="Hapus permanen" onClick={() => setPurge(r)}><Trash2 /></Button>}
        </>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Dokumen PDF"
        description="Seluruh dokumen digital yang terhubung dengan berkas permohonan. Unggah dokumen baru dari halaman detail permohonan."
      />
      <Card>
        <div className="grid gap-2 border-b p-3 md:grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))]">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setParam('q', v) }} placeholder="Judul, nama file, no. permohonan, pemohon" className="sm:w-full" />
          <NativeSelect aria-label="Kategori" value={category} onChange={(e) => setParam('category', e.target.value)}>
            <option value="">Semua kategori</option>
            {DOCUMENT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Tingkat akses" value={access} onChange={(e) => setParam('access', e.target.value)}>
            <option value="">Semua akses</option>
            {ACCESS_LEVELS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Cakupan versi" value={scope} onChange={(e) => setParam('scope', e.target.value === 'latest' ? '' : e.target.value)}>
            <option value="latest">Versi terbaru</option>
            <option value="all">Semua versi</option>
            {can('documents.manage') && <option value="deleted">Dokumen terhapus</option>}
          </NativeSelect>
          <Input type="date" aria-label="Diunggah dari" value={from} onChange={(e) => setParam('from', e.target.value)} />
          <Input type="date" aria-label="Diunggah sampai" value={to} onChange={(e) => setParam('to', e.target.value)} />
        </div>
        <DataTable
          columns={columns} rows={list.rows} rowKey={(r) => r.id} loading={list.isFetching} error={list.error} onRetry={() => list.refetch()}
          sort={list.sort} onSortChange={list.setSort}
          empty={<EmptyState title="Belum ada dokumen" description="Buka salah satu permohonan lalu pilih Unggah dokumen untuk menambahkan PDF." action={<Button asChild variant="outline"><Link to="/permohonan">Buka data permohonan</Link></Button>} />}
          footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} onPageSizeChange={list.setPageSize} />}
        />
      </Card>
      <PdfPreviewDialog doc={preview} onOpenChange={(o) => !o && setPreview(null)} />
      <ConfirmDialog
        open={!!purge} onOpenChange={(o) => !o && setPurge(null)}
        title="Hapus permanen?"
        description={<>Dokumen <strong>{purge?.title}</strong> beserta seluruh versinya akan dihapus dari penyimpanan dan tidak dapat dipulihkan. Tindakan ini tercatat di audit trail.</>}
        confirmLabel="Hapus permanen" destructive
        onConfirm={async () => {
          const { data: group, error: ge } = await supabase.from('archive_documents').select('id, storage_path').eq('document_group_id', purge!.document_group_id)
          if (ge) { toast.error(errorMessage(ge)); throw ge }
          const { error } = await supabase.from('archive_documents').delete().eq('document_group_id', purge!.document_group_id)
          if (error) { toast.error(errorMessage(error)); throw error }
          const rm = await supabase.storage.from(DOCUMENT_BUCKET).remove(group.map((g) => g.storage_path))
          if (rm.error) toast.warning(`Catatan dihapus, tetapi file gagal dihapus dari storage: ${errorMessage(rm.error)}`)
          else toast.success('Dokumen dihapus permanen.')
          qc.invalidateQueries({ queryKey: ['documents'] })
        }}
      />
    </div>
  )
}
