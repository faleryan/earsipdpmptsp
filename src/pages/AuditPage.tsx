import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FileSpreadsheet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { likePattern, pgrstQuote } from '@/lib/utils'
import { exportRawExcel } from '@/lib/export'
import { ACTIVITY_LABELS, ENTITY_LABELS, ROLE_LABELS } from '@/lib/constants'
import { useDebounce } from '@/hooks/useDebounce'
import { usePagedList } from '@/hooks/usePagedList'
import { PageHeader } from '@/components/common/PageHeader'
import { DataTable, Pagination, type Column } from '@/components/common/DataTable'
import { SearchInput } from '@/components/common/SearchInput'
import { EmptyState } from '@/components/common/States'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ActivityLog, RoleCode } from '@/types'

const actionVariant = (a: string) =>
  a === 'delete' ? 'danger' : a === 'insert' ? 'success' : a === 'update' ? 'default' : a.startsWith('import') || a.startsWith('backup') ? 'navy' : 'muted'

function JsonBlock({ title, data }: { title: string; data: Record<string, unknown> | null }) {
  if (!data || !Object.keys(data).length) return null
  return (
    <div>
      <p className="mb-1 text-sm font-semibold">{title}</p>
      <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed">{JSON.stringify(data, null, 2)}</pre>
    </div>
  )
}

export default function AuditPage() {
  const [search, setSearch] = useState('')
  const q = useDebounce(search)
  const [userId, setUserId] = useState('')
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [detail, setDetail] = useState<ActivityLog | null>(null)
  const [exporting, setExporting] = useState(false)

  const users = useQuery({
    queryKey: ['profiles', 'options'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name, email').order('full_name')
      if (error) throw error
      return data
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (query: any) => {
    let x = query
    if (userId) x = x.eq('user_id', userId)
    if (action) x = action.endsWith('.') ? x.like('action', `${action}%`) : x.eq('action', action)
    if (entity) x = x.eq('entity_type', entity)
    if (from) x = x.gte('created_at', from)
    if (to) x = x.lte('created_at', `${to}T23:59:59`)
    if (q.trim()) {
      const p = pgrstQuote(likePattern(q.trim()))
      x = x.or(`description.ilike.${p},user_email.ilike.${p},entity_id.eq.${pgrstQuote(q.trim())}`)
    }
    return x
  }

  const list = usePagedList<ActivityLog>({
    queryKey: ['activity_logs', q, userId, action, entity, from, to],
    defaultSort: { column: 'created_at', ascending: false },
    pageSize: 50,
    build: () => applyFilters(supabase.from('activity_logs').select('*', { count: 'exact' })),
  })

  const doExport = async () => {
    setExporting(true)
    try {
      const rows: ActivityLog[] = []
      for (let i = 0; i < 20; i++) {
        const { data, error } = await applyFilters(supabase.from('activity_logs').select('*')).order('created_at', { ascending: false }).range(i * 1000, i * 1000 + 999)
        if (error) throw error
        rows.push(...(data as ActivityLog[]))
        if (data.length < 1000) break
      }
      await exportRawExcel([{
        name: 'Audit trail',
        rows: rows.map((r) => ({
          Waktu: formatDateTime(r.created_at), Pengguna: r.user_email ?? 'Sistem', Peran: r.user_role ? ROLE_LABELS[r.user_role as RoleCode] ?? r.user_role : '',
          Aksi: ACTIVITY_LABELS[r.action] ?? r.action, Objek: ENTITY_LABELS[r.entity_type ?? ''] ?? r.entity_type ?? '', 'ID objek': r.entity_id ?? '',
          Keterangan: r.description ?? '', 'Data lama': r.old_data ? JSON.stringify(r.old_data) : '', 'Data baru': r.new_data ? JSON.stringify(r.new_data) : '',
        })),
      }], 'audit-trail')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  const columns: Column<ActivityLog>[] = [
    { key: 'created_at', header: 'Waktu', sortable: true, cell: (r) => <span className="whitespace-nowrap tabular">{formatDateTime(r.created_at)}</span> },
    { key: 'user_email', header: 'Pengguna', sortable: true, cell: (r) => <div className="min-w-40"><p className="text-sm">{r.user_email ?? 'Sistem'}</p><p className="text-xs text-muted-foreground">{r.user_role ? ROLE_LABELS[r.user_role as RoleCode] ?? r.user_role : ''}</p></div> },
    { key: 'action', header: 'Aksi', sortable: true, cell: (r) => <Badge variant={actionVariant(r.action) as 'default'}>{ACTIVITY_LABELS[r.action] ?? r.action}</Badge> },
    { key: 'entity_type', header: 'Objek', sortable: true, cell: (r) => ENTITY_LABELS[r.entity_type ?? ''] ?? r.entity_type ?? '—' },
    {
      key: 'description', header: 'Keterangan',
      cell: (r) => (
        <div className="min-w-72 max-w-xl text-sm">
          <p className="line-clamp-2">{r.description}</p>
          {r.action === 'update' && r.new_data && <p className="text-xs text-muted-foreground">Kolom: {Object.keys(r.new_data).join(', ')}</p>}
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Audit trail"
        description="Catatan seluruh perubahan data dan aktivitas penting. Log tidak dapat diubah atau dihapus oleh siapa pun dari aplikasi."
        actions={<Button variant="outline" onClick={doExport} loading={exporting}><FileSpreadsheet /> Ekspor Excel</Button>}
      />
      <Card>
        <div className="grid gap-2 border-b p-3 md:grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))]">
          <SearchInput value={search} onChange={setSearch} placeholder="Cari keterangan, email, atau ID objek" className="sm:w-full" />
          <NativeSelect aria-label="Pengguna" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Semua pengguna</option>
            {users.data?.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Aksi" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Semua aksi</option>
            <option value="insert">Menambah</option>
            <option value="update">Mengubah</option>
            <option value="delete">Menghapus</option>
            <option value="login">Masuk</option>
            <option value="document.">Akses dokumen</option>
            <option value="import.">Impor</option>
            <option value="report.export">Ekspor laporan</option>
            <option value="backup.">Cadangan & pemulihan</option>
            <option value="user.">Manajemen pengguna</option>
          </NativeSelect>
          <NativeSelect aria-label="Objek" value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Semua objek</option>
            {Object.entries(ENTITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </NativeSelect>
          <Input type="date" aria-label="Dari tanggal" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" aria-label="Sampai tanggal" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <DataTable columns={columns} rows={list.rows} rowKey={(r) => r.id} loading={list.isFetching} error={list.error} onRetry={() => list.refetch()}
          sort={list.sort} onSortChange={list.setSort} onRowClick={setDetail} dense
          empty={<EmptyState title="Tidak ada aktivitas yang cocok" />}
          footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} onPageSizeChange={list.setPageSize} />} />
      </Card>
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{detail && (ACTIVITY_LABELS[detail.action] ?? detail.action)} {detail?.entity_type && (ENTITY_LABELS[detail.entity_type] ?? detail.entity_type).toLowerCase()}</DialogTitle>
            <DialogDescription>{detail && `${formatDateTime(detail.created_at)} · ${detail.user_email ?? 'Sistem'} · ID objek ${detail.entity_id ?? '—'}`}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {detail?.description && <p className="text-sm">{detail.description}</p>}
            <JsonBlock title="Data sebelum" data={detail?.old_data ?? null} />
            <JsonBlock title="Data sesudah" data={detail?.new_data ?? null} />
            <JsonBlock title="Metadata" data={detail?.metadata ?? null} />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  )
}
