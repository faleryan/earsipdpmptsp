import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { likePattern, pgrstQuote } from '@/lib/utils'
import { maskNik } from '@/lib/format'
import { useAuth } from '@/hooks/useAuth'
import { useDebounce } from '@/hooks/useDebounce'
import { usePagedList } from '@/hooks/usePagedList'
import { PageHeader } from '@/components/common/PageHeader'
import { DataTable, Pagination, type Column } from '@/components/common/DataTable'
import { SearchInput } from '@/components/common/SearchInput'
import { SourceBadge } from '@/components/common/Badges'
import { EmptyState } from '@/components/common/States'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { FormField } from '@/components/common/FormField'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { Applicant } from '@/types'

type Row = Applicant & { applications: { count: number }[] }

export const applicantSchema = z.object({
  full_name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(200),
  nik: z.string().trim().regex(/^(\d{16})?$/, 'NIK harus 16 digit angka').optional().or(z.literal('')),
  phone: z.string().trim().max(30).regex(/^[0-9+\-\s()]*$/, 'Hanya angka, spasi, +, -').optional(),
  email: z.string().trim().email('Format email tidak valid').optional().or(z.literal('')),
  address: z.string().trim().max(500).optional(),
})
export type ApplicantForm = z.infer<typeof applicantSchema>

export const toApplicantPayload = (v: ApplicantForm) => ({
  full_name: v.full_name,
  nik: v.nik || null,
  phone: v.phone?.replace(/[^0-9+]/g, '') || null,
  email: v.email?.toLowerCase() || null,
  address: v.address || null,
})

export function ApplicantFormDialog({
  open, onOpenChange, applicant, onSaved,
}: { open: boolean; onOpenChange: (o: boolean) => void; applicant?: Applicant | null; onSaved?: (a: Applicant) => void }) {
  const qc = useQueryClient()
  const form = useForm<ApplicantForm>({
    resolver: zodResolver(applicantSchema),
    values: {
      full_name: applicant?.full_name ?? '', nik: applicant?.nik ?? '', phone: applicant?.phone ?? '',
      email: applicant?.email ?? '', address: applicant?.address ?? '',
    },
  })
  const mutation = useMutation({
    mutationFn: async (v: ApplicantForm) => {
      const payload = toApplicantPayload(v)
      const res = applicant
        ? await supabase.from('applicants').update(payload).eq('id', applicant.id).select().single()
        : await supabase.from('applicants').insert(payload).select().single()
      if (res.error) throw res.error
      return res.data as Applicant
    },
    onSuccess: (a) => {
      toast.success(applicant ? 'Data pemohon diperbarui.' : 'Pemohon ditambahkan.')
      qc.invalidateQueries({ queryKey: ['applicants'] })
      onSaved?.(a)
      onOpenChange(false)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const err = form.formState.errors
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form noValidate onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{applicant ? 'Ubah data pemohon' : 'Tambah pemohon'}</DialogTitle>
            {applicant?.data_source === 'import' && (
              <DialogDescription>Data ini berasal dari SiCANTIK. Perubahan akan ditandai sebagai edit manual dan dilindungi dari penimpaan impor.</DialogDescription>
            )}
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nama lengkap" htmlFor="ap-name" required error={err.full_name?.message} className="sm:col-span-2">
              <Input id="ap-name" {...form.register('full_name')} aria-invalid={!!err.full_name} />
            </FormField>
            <FormField label="NIK" htmlFor="ap-nik" error={err.nik?.message} hint="16 digit sesuai KTP">
              <Input id="ap-nik" inputMode="numeric" maxLength={16} {...form.register('nik')} aria-invalid={!!err.nik} />
            </FormField>
            <FormField label="No. HP / telepon" htmlFor="ap-phone" error={err.phone?.message}>
              <Input id="ap-phone" inputMode="tel" {...form.register('phone')} />
            </FormField>
            <FormField label="Email" htmlFor="ap-email" error={err.email?.message} className="sm:col-span-2">
              <Input id="ap-email" type="email" {...form.register('email')} />
            </FormField>
            <FormField label="Alamat" htmlFor="ap-address" className="sm:col-span-2">
              <Textarea id="ap-address" rows={2} {...form.register('address')} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
            <Button type="submit" loading={mutation.isPending}>{applicant ? 'Simpan perubahan' : 'Tambah pemohon'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function ApplicantsPage() {
  const { can, profile } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [source, setSource] = useState('')
  const q = useDebounce(search)
  const [editing, setEditing] = useState<Applicant | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const reveal = can('pii.view')

  const list = usePagedList<Row>({
    queryKey: ['applicants', q, source],
    defaultSort: { column: 'full_name', ascending: true },
    build: () => {
      let query = supabase.from('applicants').select('*, applications(count)', { count: 'exact' })
      if (q.trim()) {
        const p = pgrstQuote(likePattern(q.trim()))
        query = query.or(`full_name.ilike.${p},nik.ilike.${p},phone.ilike.${p},email.ilike.${p}`)
      }
      if (source) query = query.eq('data_source', source)
      return query
    },
  })

  const canEdit = (a: Applicant) => can('archive.edit_all') || (can('archive.write') && a.created_by === profile?.id)

  const columns: Column<Row>[] = [
    {
      key: 'full_name', header: 'Nama pemohon', sortable: true,
      cell: (r) => <div className="min-w-48"><p className="font-medium">{r.full_name}</p><p className="text-xs text-muted-foreground">{r.email ?? '—'}</p></div>,
    },
    { key: 'nik', header: 'NIK', sortable: true, cell: (r) => <span className="tabular">{maskNik(r.nik, reveal)}</span> },
    { key: 'phone', header: 'Telepon', cell: (r) => <span className="tabular">{r.phone ?? '—'}</span> },
    { key: 'applications', header: 'Permohonan', cell: (r) => <span className="tabular font-semibold">{r.applications?.[0]?.count ?? 0}</span> },
    { key: 'data_source', header: 'Sumber', cell: (r) => <SourceBadge source={r.data_source} manual={r.is_manually_edited} /> },
    {
      key: 'actions', header: <span className="sr-only">Aksi</span>, className: 'w-10 text-right',
      cell: (r) => (canEdit(r) || can('archive.delete')) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Aksi"><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => navigate(`/pencarian?applicantId=${r.id}`)}><Search /> Lihat arsip</DropdownMenuItem>
            {canEdit(r) && <DropdownMenuItem onSelect={() => setEditing(r)}><Pencil /> Ubah</DropdownMenuItem>}
            {can('archive.delete') && <DropdownMenuItem className="text-destructive" onSelect={() => setDeleting(r)}><Trash2 /> Hapus</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Data pemohon"
        description="Orang perseorangan yang mengajukan permohonan izin. Klik baris untuk melihat seluruh arsipnya."
        actions={can('archive.write') && <Button onClick={() => setEditing(null)}><Plus /> Tambah pemohon</Button>}
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
          <SearchInput value={search} onChange={setSearch} placeholder="Cari nama, NIK, telepon, email" className="sm:w-96" />
          <NativeSelect aria-label="Sumber data" className="sm:w-44" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Semua sumber</option>
            <option value="import">SiCANTIK</option>
            <option value="manual">Manual</option>
          </NativeSelect>
        </div>
        <DataTable
          columns={columns}
          rows={list.rows}
          rowKey={(r) => r.id}
          loading={list.isFetching}
          error={list.error}
          onRetry={() => list.refetch()}
          sort={list.sort}
          onSortChange={list.setSort}
          onRowClick={(r) => navigate(`/pencarian?applicantId=${r.id}`)}
          empty={<EmptyState title={q ? 'Pemohon tidak ditemukan' : 'Belum ada data pemohon'} description={q ? 'Coba kata kunci lain.' : 'Data pemohon terbentuk otomatis saat impor SiCANTIK, atau tambahkan manual.'} />}
          footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} onPageSizeChange={list.setPageSize} />}
        />
      </Card>

      <ApplicantFormDialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} applicant={editing} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Hapus pemohon?"
        description={<>Data <strong>{deleting?.full_name}</strong> akan dihapus permanen. Pemohon yang masih memiliki permohonan tidak dapat dihapus.</>}
        confirmLabel="Hapus"
        destructive
        onConfirm={async () => {
          const { error } = await supabase.from('applicants').delete().eq('id', deleting!.id)
          if (error) { toast.error(errorMessage(error)); throw error }
          toast.success('Pemohon dihapus.')
          qc.invalidateQueries({ queryKey: ['applicants'] })
        }}
      />
    </div>
  )
}
