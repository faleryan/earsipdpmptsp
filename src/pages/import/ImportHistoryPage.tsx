import { Link, useNavigate } from 'react-router-dom'
import { FileUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatDateTime, formatNumber } from '@/lib/format'
import { useAuth } from '@/hooks/useAuth'
import { usePagedList } from '@/hooks/usePagedList'
import { PageHeader } from '@/components/common/PageHeader'
import { DataTable, Pagination, type Column } from '@/components/common/DataTable'
import { ImportStatusBadge } from '@/components/common/Badges'
import { EmptyState } from '@/components/common/States'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { ImportBatch } from '@/types'

export default function ImportHistoryPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const list = usePagedList<ImportBatch>({
    queryKey: ['import_batches', 'history'],
    defaultSort: { column: 'created_at', ascending: false },
    build: () => supabase.from('import_batches').select('*, importer:profiles!import_batches_imported_by_fkey(full_name, email)', { count: 'exact' }),
  })
  const num = (n: number, tone = '') => <span className={`tabular ${tone}`}>{formatNumber(n)}</span>
  const columns: Column<ImportBatch>[] = [
    { key: 'created_at', header: 'Waktu', sortable: true, cell: (r) => <span className="whitespace-nowrap tabular">{formatDateTime(r.created_at)}</span> },
    { key: 'file_name', header: 'File', sortable: true, cell: (r) => <div className="min-w-52"><Link to={`/impor/${r.id}`} className="font-medium hover:text-primary hover:underline">{r.file_name}</Link><p className="text-xs text-muted-foreground">{r.importer?.full_name || r.importer?.email || '—'}</p></div> },
    { key: 'status', header: 'Status', cell: (r) => <ImportStatusBadge status={r.status} /> },
    { key: 'total_rows', header: 'Baris', sortable: true, cell: (r) => num(r.total_rows) },
    { key: 'inserted_count', header: 'Baru', cell: (r) => num(r.inserted_count, 'text-primary font-semibold') },
    { key: 'updated_count', header: 'Diperbarui', cell: (r) => num(r.updated_count) },
    { key: 'unchanged_count', header: 'Tetap', cell: (r) => num(r.unchanged_count, 'text-muted-foreground') },
    { key: 'skipped_count', header: 'Dilewati', cell: (r) => num(r.skipped_count, 'text-muted-foreground') },
    { key: 'failed_count', header: 'Gagal', cell: (r) => num(r.failed_count, r.failed_count ? 'text-destructive font-semibold' : 'text-muted-foreground') },
  ]
  return (
    <div>
      <PageHeader
        title="Riwayat impor"
        description="Setiap proses impor tercatat lengkap: siapa, kapan, file apa, pemetaan kolom, dan hasil per baris."
        actions={can('import.run') && <Button asChild><Link to="/impor"><FileUp /> Impor baru</Link></Button>}
      />
      <Card>
        <DataTable columns={columns} rows={list.rows} rowKey={(r) => r.id} loading={list.isFetching} error={list.error} onRetry={() => list.refetch()}
          sort={list.sort} onSortChange={list.setSort} onRowClick={(r) => navigate(`/impor/${r.id}`)}
          empty={<EmptyState title="Belum ada riwayat impor" />}
          footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} onPageSizeChange={list.setPageSize} />} />
      </Card>
    </div>
  )
}
