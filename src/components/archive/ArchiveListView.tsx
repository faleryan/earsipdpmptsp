import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { FileDown, FileSpreadsheet, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { applyArchiveFilters, fetchAllArchive, type ArchiveFilters } from '@/lib/api'
import { exportExcel, exportPdf } from '@/lib/export'
import { logActivity } from '@/lib/activity'
import { errorMessage } from '@/lib/errors'
import { formatNumber } from '@/lib/format'
import { useAuth } from '@/hooks/useAuth'
import { useSettings } from '@/hooks/useSettings'
import { usePagedList } from '@/hooks/usePagedList'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable, Pagination, type Column, type SortState } from '@/components/common/DataTable'
import { EmptyState } from '@/components/common/States'
import { ArchiveFilterPanel } from './ArchiveFilters'
import { archiveColumns } from './archiveColumns'
import { archiveExportColumns, archivePdfColumns } from './archiveExport'
import type { ArchiveRow } from '@/types'

interface Props {
  queryKey: string
  variant?: 'compact' | 'advanced'
  fixed?: ArchiveFilters
  hideFilters?: (keyof ArchiveFilters)[]
  defaultSort?: SortState
  columns?: (reveal: boolean) => Column<ArchiveRow>[]
  exportTitle: string
  emptyState?: ReactNode
  contextLabel?: ReactNode
}

function describeFilters(f: ArchiveFilters) {
  const parts: string[] = []
  if (f.q) parts.push(`kata kunci "${f.q}"`)
  if (f.year) parts.push(`tahun ${f.year}`)
  if (f.dateFrom || f.dateTo) parts.push(`tanggal permohonan ${f.dateFrom ?? '…'} s.d. ${f.dateTo ?? '…'}`)
  if (f.issuedFrom || f.issuedTo) parts.push(`tanggal penetapan ${f.issuedFrom ?? '…'} s.d. ${f.issuedTo ?? '…'}`)
  if (f.sector) parts.push(`sektor ${f.sector}`)
  if (f.status) parts.push(`status ${f.status}`)
  if (f.complete === 'no') parts.push('dokumen belum lengkap')
  return parts.length ? `Filter: ${parts.join(', ')}` : 'Seluruh arsip'
}

export function ArchiveListView({ queryKey, variant = 'compact', fixed = {}, hideFilters, defaultSort, columns, exportTitle, emptyState, contextLabel }: Props) {
  const navigate = useNavigate()
  const { can, profile } = useAuth()
  const { data: settings } = useSettings()
  const [filters, setFilters] = useUrlFilters()
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null)
  const reveal = can('pii.view')
  const all = { ...filters, ...fixed }

  const list = usePagedList<ArchiveRow>({
    queryKey: ['archive', queryKey, all],
    defaultSort: defaultSort ?? { column: 'application_date', ascending: false },
    build: () => applyArchiveFilters(supabase.from('v_archive_list').select('*', { count: 'exact' }), all),
  })

  const doExport = async (kind: 'xlsx' | 'pdf') => {
    if (!settings) return
    if (list.total > 20000) return void toast.error('Hasil lebih dari 20.000 baris. Persempit filter sebelum mengekspor.')
    setExporting(kind)
    try {
      const rows = (await fetchAllArchive(all, list.sort.column)) as unknown as ArchiveRow[]
      const meta = { title: exportTitle.toUpperCase(), subtitle: `${describeFilters(all)} — ${formatNumber(rows.length)} data`, identity: settings.identity, generatedBy: profile?.full_name || profile?.email }
      if (kind === 'xlsx') await exportExcel(rows, archiveExportColumns(reveal), meta, exportTitle)
      else await exportPdf(rows, archivePdfColumns(reveal), meta, exportTitle)
      void logActivity('search.export', 'applications', null, `Ekspor ${kind.toUpperCase()} "${exportTitle}" (${rows.length} data)`, { filters: all, format: kind })
      toast.success(`File ${kind === 'xlsx' ? 'Excel' : 'PDF'} berhasil dibuat.`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setExporting(null)
    }
  }

  const contextFilters = (['applicantId', 'companyId', 'importBatchId'] as const).filter((k) => filters[k])

  return (
    <Card>
      <ArchiveFilterPanel value={filters} onChange={setFilters} variant={variant} hide={hideFilters} />
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="tabular"><strong className="text-foreground">{formatNumber(list.total)}</strong> arsip ditemukan</span>
          {contextLabel}
          {contextFilters.map((k) => (
            <Badge key={k} variant="outline" className="gap-1">
              {k === 'applicantId' ? 'Pemohon tertentu' : k === 'companyId' ? 'Badan usaha tertentu' : 'Batch impor tertentu'}
              <button aria-label="Hapus filter" onClick={() => setFilters({ ...filters, [k]: undefined })}><X className="size-3" /></button>
            </Badge>
          ))}
        </div>
        {(can('reports.view') || can('archive.write')) && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => doExport('xlsx')} loading={exporting === 'xlsx'} disabled={!list.total || !!exporting}><FileSpreadsheet /> Excel</Button>
            <Button variant="outline" size="sm" onClick={() => doExport('pdf')} loading={exporting === 'pdf'} disabled={!list.total || !!exporting}><FileDown /> PDF</Button>
          </div>
        )}
      </div>
      <DataTable
        columns={columns ? columns(reveal) : archiveColumns({ revealNik: reveal, withSource: variant === 'advanced' })}
        rows={list.rows}
        rowKey={(r) => r.id}
        loading={list.isFetching}
        error={list.error}
        onRetry={() => list.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={(r) => navigate(`/permohonan/${r.id}`)}
        empty={emptyState ?? <EmptyState title="Tidak ada arsip yang cocok" description="Ubah kata kunci atau atur ulang filter." />}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} onPageSizeChange={list.setPageSize} />}
      />
    </Card>
  )
}
