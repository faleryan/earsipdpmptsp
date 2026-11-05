import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState, ErrorState, LoadingRows } from './States'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface Column<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  sortable?: boolean
  className?: string
  headClassName?: string
}

export interface SortState {
  column: string
  ascending: boolean
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[] | undefined
  rowKey: (row: T) => string
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  empty?: ReactNode
  sort?: SortState
  onSortChange?: (s: SortState) => void
  onRowClick?: (row: T) => void
  selectable?: boolean
  selected?: Set<string>
  onSelectedChange?: (s: Set<string>) => void
  footer?: ReactNode
  dense?: boolean
}

export function DataTable<T>({
  columns, rows, rowKey, loading, error, onRetry, empty, sort, onSortChange, onRowClick,
  selectable, selected, onSelectedChange, footer, dense,
}: DataTableProps<T>) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (loading && !rows) return <LoadingRows cols={Math.min(columns.length, 6)} />
  if (!rows?.length) return <>{empty ?? <EmptyState title="Belum ada data" description="Data yang sesuai akan tampil di sini." />}</>

  const allKeys = rows.map(rowKey)
  const allSelected = selectable && allKeys.every((k) => selected?.has(k))
  const someSelected = selectable && allKeys.some((k) => selected?.has(k))

  return (
    <div className={cn('relative', loading && 'opacity-60 transition-opacity')}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {selectable && (
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Pilih semua baris"
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={(v) => {
                    const next = new Set(selected)
                    allKeys.forEach((k) => (v ? next.add(k) : next.delete(k)))
                    onSelectedChange?.(next)
                  }}
                />
              </TableHead>
            )}
            {columns.map((c) => {
              const active = sort?.column === c.key
              return (
                <TableHead key={c.key} className={c.headClassName} aria-sort={active ? (sort!.ascending ? 'ascending' : 'descending') : undefined}>
                  {c.sortable && onSortChange ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => onSortChange({ column: c.key, ascending: active ? !sort!.ascending : false })}
                    >
                      {c.header}
                      {active && (sort!.ascending ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                    </button>
                  ) : c.header}
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const key = rowKey(row)
            return (
              <TableRow
                key={key}
                data-state={selected?.has(key) ? 'selected' : undefined}
                className={cn(onRowClick && 'cursor-pointer')}
                onClick={onRowClick ? (e) => {
                  if ((e.target as HTMLElement).closest('button,a,input,[role=checkbox],[role=menuitem]')) return
                  onRowClick(row)
                } : undefined}
              >
                {selectable && (
                  <TableCell className="w-10">
                    <Checkbox
                      aria-label="Pilih baris"
                      checked={selected?.has(key) ?? false}
                      onCheckedChange={(v) => {
                        const next = new Set(selected)
                        if (v) next.add(key)
                        else next.delete(key)
                        onSelectedChange?.(next)
                      }}
                    />
                  </TableCell>
                )}
                {columns.map((c) => (
                  <TableCell key={c.key} className={cn(dense && 'py-1.5', c.className)}>{c.cell(row)}</TableCell>
                ))}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {footer}
    </div>
  )
}

export function Pagination({
  page, pageSize, total, onPageChange, onPageSizeChange,
}: { page: number; pageSize: number; total: number; onPageChange: (p: number) => void; onPageSizeChange?: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className="flex flex-col gap-2 border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground tabular">
        Menampilkan {formatNumber(from)}–{formatNumber(to)} dari {formatNumber(total)} data
      </p>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <NativeSelect aria-label="Jumlah per halaman" className="h-8 w-auto" value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / halaman</option>)}
          </NativeSelect>
        )}
        <Button variant="outline" size="icon-sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Halaman sebelumnya">
          <ChevronLeft />
        </Button>
        <span className="min-w-20 text-center tabular">{formatNumber(page)} / {formatNumber(pages)}</span>
        <Button variant="outline" size="icon-sm" onClick={() => onPageChange(page + 1)} disabled={page >= pages} aria-label="Halaman berikutnya">
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
