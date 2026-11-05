import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Download, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { formatBytes, formatDateTime, formatNumber } from '@/lib/format'
import { IMPORT_ERROR_TYPES } from '@/lib/constants'
import { fieldLabel } from '@/lib/import/fields'
import { useAuth } from '@/hooks/useAuth'
import { usePagedList } from '@/hooks/usePagedList'
import { PageHeader } from '@/components/common/PageHeader'
import { DataTable, Pagination, type Column } from '@/components/common/DataTable'
import { ImportStatusBadge } from '@/components/common/Badges'
import { EmptyState, ErrorState, FullPageLoader } from '@/components/common/States'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/input'
import { downloadErrorReport } from './importTypes'
import type { ImportBatch, ImportError } from '@/types'

export default function ImportBatchPage() {
  const { id } = useParams<{ id: string }>()
  const { can } = useAuth()
  const [severity, setSeverity] = useState('')
  const [downloading, setDownloading] = useState(false)
  const batch = useQuery({
    queryKey: ['import_batches', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('import_batches').select('*, importer:profiles!import_batches_imported_by_fkey(full_name, email)').eq('id', id!).maybeSingle()
      if (error) throw error
      return data as ImportBatch | null
    },
  })
  const errors = usePagedList<ImportError>({
    queryKey: ['import_errors', id, severity],
    enabled: can('import.run'),
    defaultSort: { column: 'row_number', ascending: true },
    build: () => {
      let q = supabase.from('import_errors').select('*', { count: 'exact' }).eq('batch_id', id!)
      if (severity === 'error') q = q.eq('severity', 'error')
      if (severity === 'skipped') q = q.eq('severity', 'warning').neq('error_type', 'validation')
      if (severity === 'warning') q = q.eq('severity', 'warning').eq('error_type', 'validation')
      return q
    },
  })

  if (batch.isLoading) return <FullPageLoader />
  if (batch.error) return <Card><ErrorState error={batch.error} /></Card>
  const b = batch.data
  if (!b) return <Card><ErrorState error="Batch impor tidak ditemukan." /></Card>

  const columns: Column<ImportError>[] = [
    { key: 'row_number', header: 'Baris', sortable: true, cell: (r) => <span className="tabular">{r.row_number ?? '—'}</span> },
    { key: 'severity', header: 'Tingkat', cell: (r) => r.severity === 'error' ? <Badge variant="danger">Galat</Badge> : r.error_type === 'validation' ? <Badge variant="warning">Peringatan</Badge> : <Badge variant="muted">Dilewati</Badge> },
    { key: 'error_type', header: 'Jenis', cell: (r) => IMPORT_ERROR_TYPES[r.error_type] ?? r.error_type },
    { key: 'ref', header: 'Data', cell: (r) => <div className="min-w-44 text-xs"><p>{r.application_number ?? '—'}</p>{r.source_id && <p className="text-muted-foreground tabular">ID {r.source_id}</p>}</div> },
    { key: 'message', header: 'Pesan', cell: (r) => <div className="min-w-72 text-sm">{r.field && <span className="font-medium">{r.field.split(', ').map(fieldLabel).join(', ')}: </span>}{r.message}</div> },
  ]
  const mapping = Object.entries(b.column_mapping ?? {})

  return (
    <div>
      <Link to="/impor/riwayat" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Riwayat impor</Link>
      <PageHeader
        title={b.file_name}
        description={<span className="flex flex-wrap items-center gap-2"><ImportStatusBadge status={b.status} /> {formatDateTime(b.created_at)} oleh {b.importer?.full_name || b.importer?.email || '—'}</span>}
        actions={
          <>
            <Button variant="outline" asChild><Link to={`/pencarian?importBatchId=${b.id}`}><Search /> Arsip dari batch ini</Link></Button>
            {can('import.run') && (
              <Button variant="outline" loading={downloading} onClick={async () => {
                setDownloading(true)
                try { await downloadErrorReport(b.id, b.file_name) } catch (e) { toast.error(errorMessage(e)) } finally { setDownloading(false) }
              }}><Download /> Laporan kesalahan</Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-7">
        {[
          ['Total baris', b.total_rows, ''], ['Baru', b.inserted_count, 'text-primary'], ['Diperbarui', b.updated_count, 'text-[#8a5a12]'],
          ['Tidak berubah', b.unchanged_count, 'text-muted-foreground'], ['Dilewati', b.skipped_count, 'text-muted-foreground'],
          ['Gagal', b.failed_count, 'text-destructive'], ['Peringatan', b.warning_count, 'text-[#8a5a12]'],
        ].map(([l, v, t]) => (
          <div key={l as string} className="rounded-lg border bg-card px-4 py-3">
            <p className={`text-xs font-medium ${t || 'text-muted-foreground'}`}>{l}</p>
            <p className="text-2xl font-bold tabular">{formatNumber(v as number)}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <div className="flex items-center justify-between gap-2 border-b p-3">
            <p className="text-sm font-semibold">Catatan per baris</p>
            <NativeSelect aria-label="Filter tingkat" className="w-48" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">Semua</option>
              <option value="error">Galat</option>
              <option value="skipped">Dilewati</option>
              <option value="warning">Peringatan</option>
            </NativeSelect>
          </div>
          {can('import.run') ? (
            <DataTable columns={columns} rows={errors.rows} rowKey={(r) => r.id} loading={errors.isFetching} error={errors.error}
              sort={errors.sort} onSortChange={errors.setSort} dense
              empty={<EmptyState title="Tidak ada catatan" description="Seluruh baris diproses tanpa galat, peringatan, atau baris dilewati." />}
              footer={<Pagination page={errors.page} pageSize={errors.pageSize} total={errors.total} onPageChange={errors.setPage} onPageSizeChange={errors.setPageSize} />} />
          ) : <p className="p-6 text-sm text-muted-foreground">Detail per baris memuat data pribadi dan hanya dapat dilihat Admin Arsip / Super Admin.</p>}
        </Card>
        <Card>
          <CardHeader><CardTitle>Detail proses</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p><span className="text-muted-foreground">Ukuran:</span> {formatBytes(b.file_size)}{b.sheet_name ? ` · sheet ${b.sheet_name}` : ''}</p>
            <p><span className="text-muted-foreground">Kunci pencocokan:</span> {b.match_key === 'source_id' ? 'ID SiCANTIK' : 'Nomor permohonan'}</p>
            <p><span className="text-muted-foreground">Data berubah:</span> {(b.options as { update_changed?: boolean }).update_changed ? 'diperbarui' : 'dilewati'}</p>
            <p><span className="text-muted-foreground">Mulai – selesai:</span> {formatDateTime(b.started_at)} – {formatDateTime(b.finished_at)}</p>
            {b.file_hash && <p className="break-all text-xs"><span className="text-muted-foreground">SHA-256:</span> {b.file_hash}</p>}
            {b.notes && <p><span className="text-muted-foreground">Catatan:</span> {b.notes}</p>}
            <div>
              <p className="mb-1 font-medium">Pemetaan kolom</p>
              <ul className="space-y-0.5 text-xs">
                {mapping.map(([k, v]) => <li key={k}><span className="text-muted-foreground">{fieldLabel(k)}</span> ← {String(v)}</li>)}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
