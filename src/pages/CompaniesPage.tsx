import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { likePattern, pgrstQuote } from '@/lib/utils'
import { BUSINESS_FORMS, SECTORS } from '@/lib/constants'
import { getApplicantOption, searchApplicants } from '@/lib/api'
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
import { Combobox } from '@/components/common/Combobox'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { Company } from '@/types'

type Row = Company & { applications: { count: number }[] }

const schema = z.object({
  name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(250),
  business_form: z.string().optional(),
  nib: z.string().trim().regex(/^(\d{13})?$/, 'NIB harus 13 digit angka').optional(),
  npwp: z.string().trim().regex(/^([\d.\-\s]{15,22})?$/, 'Format NPWP tidak valid').optional(),
  sector: z.string().optional(),
  address: z.string().trim().max(500).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email('Format email tidak valid').optional().or(z.literal('')),
  applicant_id: z.string().nullable().optional(),
})
type FormValues = z.infer<typeof schema>

export function CompanyFormDialog({ open, onOpenChange, company }: { open: boolean; onOpenChange: (o: boolean) => void; company?: Company | null }) {
  const qc = useQueryClient()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: {
      name: company?.name ?? '', business_form: company?.business_form ?? '', nib: company?.nib ?? '', npwp: company?.npwp ?? '',
      sector: company?.sector ?? '', address: company?.address ?? '', phone: company?.phone ?? '', email: company?.email ?? '',
      applicant_id: company?.applicant_id ?? null,
    },
  })
  const mutation = useMutation({
    mutationFn: async (v: FormValues) => {
      const npwp = v.npwp?.replace(/\D/g, '') || null
      if (npwp && ![15, 16].includes(npwp.length)) throw new Error('NPWP harus 15 atau 16 digit.')
      const payload = {
        name: v.name, business_form: v.business_form || null, nib: v.nib || null, npwp,
        sector: v.sector || null, address: v.address || null, phone: v.phone || null,
        email: v.email?.toLowerCase() || null, applicant_id: v.applicant_id || null,
      }
      const res = company
        ? await supabase.from('companies').update(payload).eq('id', company.id)
        : await supabase.from('companies').insert(payload)
      if (res.error) throw res.error
    },
    onSuccess: () => {
      toast.success(company ? 'Badan usaha diperbarui.' : 'Badan usaha ditambahkan.')
      qc.invalidateQueries({ queryKey: ['companies'] })
      onOpenChange(false)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const err = form.formState.errors
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form noValidate onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="flex min-h-0 flex-col">
          <DialogHeader><DialogTitle>{company ? 'Ubah badan usaha' : 'Tambah badan usaha'}</DialogTitle></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nama badan usaha" htmlFor="co-name" required error={err.name?.message} className="sm:col-span-2">
              <Input id="co-name" {...form.register('name')} aria-invalid={!!err.name} />
            </FormField>
            <FormField label="Bentuk usaha" htmlFor="co-form">
              <NativeSelect id="co-form" {...form.register('business_form')}>
                <option value="">— Pilih —</option>
                {BUSINESS_FORMS.map((b) => <option key={b} value={b}>{b}</option>)}
              </NativeSelect>
            </FormField>
            <FormField label="Sektor" htmlFor="co-sector">
              <NativeSelect id="co-sector" {...form.register('sector')}>
                <option value="">— Pilih —</option>
                {SECTORS.map((b) => <option key={b} value={b}>{b}</option>)}
              </NativeSelect>
            </FormField>
            <FormField label="NIB" htmlFor="co-nib" error={err.nib?.message} hint="Nomor Induk Berusaha, 13 digit">
              <Input id="co-nib" inputMode="numeric" maxLength={13} {...form.register('nib')} />
            </FormField>
            <FormField label="NPWP" htmlFor="co-npwp" error={err.npwp?.message}>
              <Input id="co-npwp" {...form.register('npwp')} />
            </FormField>
            <FormField label="Telepon" htmlFor="co-phone"><Input id="co-phone" {...form.register('phone')} /></FormField>
            <FormField label="Email" htmlFor="co-email" error={err.email?.message}><Input id="co-email" type="email" {...form.register('email')} /></FormField>
            <FormField label="Penanggung jawab" htmlFor="co-applicant" className="sm:col-span-2" hint="Pemohon yang mewakili badan usaha">
              <Controller
                control={form.control}
                name="applicant_id"
                render={({ field }) => (
                  <Combobox id="co-applicant" queryKey="applicants" value={field.value ?? null} onChange={field.onChange}
                    fetchOptions={searchApplicants} fetchSelected={getApplicantOption} placeholder="Cari pemohon…" allowClear />
                )}
              />
            </FormField>
            <FormField label="Alamat" htmlFor="co-address" className="sm:col-span-2"><Textarea id="co-address" rows={2} {...form.register('address')} /></FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
            <Button type="submit" loading={mutation.isPending}>{company ? 'Simpan perubahan' : 'Tambah badan usaha'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function CompaniesPage() {
  const { can, profile } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [form, setForm] = useState('')
  const q = useDebounce(search)
  const [editing, setEditing] = useState<Company | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Row | null>(null)

  const list = usePagedList<Row>({
    queryKey: ['companies', q, form],
    defaultSort: { column: 'name', ascending: true },
    build: () => {
      let query = supabase.from('companies').select('*, applicant:applicants(id, full_name), applications(count)', { count: 'exact' })
      if (q.trim()) {
        const p = pgrstQuote(likePattern(q.trim()))
        query = query.or(`name.ilike.${p},nib.ilike.${p},npwp.ilike.${p}`)
      }
      if (form) query = query.eq('business_form', form)
      return query
    },
  })
  const canEdit = (c: Company) => can('archive.edit_all') || (can('archive.write') && c.created_by === profile?.id)

  const columns: Column<Row>[] = [
    { key: 'name', header: 'Nama badan usaha', sortable: true, cell: (r) => <div className="min-w-52"><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.address ?? '—'}</p></div> },
    { key: 'business_form', header: 'Bentuk', sortable: true, cell: (r) => r.business_form ?? '—' },
    { key: 'nib', header: 'NIB', cell: (r) => <span className="tabular">{r.nib ?? '—'}</span> },
    { key: 'sector', header: 'Sektor', sortable: true, cell: (r) => r.sector ?? '—' },
    { key: 'applicant', header: 'Penanggung jawab', cell: (r) => r.applicant?.full_name ?? '—' },
    { key: 'applications', header: 'Permohonan', cell: (r) => <span className="tabular font-semibold">{r.applications?.[0]?.count ?? 0}</span> },
    { key: 'data_source', header: 'Sumber', cell: (r) => <SourceBadge source={r.data_source} manual={r.is_manually_edited} /> },
    {
      key: 'actions', header: <span className="sr-only">Aksi</span>, className: 'w-10 text-right',
      cell: (r) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Aksi"><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => navigate(`/pencarian?companyId=${r.id}`)}><Search /> Lihat arsip</DropdownMenuItem>
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
        title="Badan usaha"
        description="Perusahaan, koperasi, yayasan, dan badan lain yang menjadi pemegang izin."
        actions={can('archive.write') && <Button onClick={() => setEditing(null)}><Plus /> Tambah badan usaha</Button>}
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
          <SearchInput value={search} onChange={setSearch} placeholder="Cari nama, NIB, NPWP" className="sm:w-96" />
          <NativeSelect aria-label="Bentuk usaha" className="sm:w-44" value={form} onChange={(e) => setForm(e.target.value)}>
            <option value="">Semua bentuk</option>
            {BUSINESS_FORMS.map((b) => <option key={b} value={b}>{b}</option>)}
          </NativeSelect>
        </div>
        <DataTable
          columns={columns} rows={list.rows} rowKey={(r) => r.id} loading={list.isFetching} error={list.error} onRetry={() => list.refetch()}
          sort={list.sort} onSortChange={list.setSort}
          empty={<EmptyState title="Belum ada badan usaha" description="Ekspor SiCANTIK contoh tidak memuat kolom badan usaha. Tambahkan manual, atau petakan kolom badan usaha saat impor bila tersedia." />}
          footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} onPageSizeChange={list.setPageSize} />}
        />
      </Card>
      <CompanyFormDialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} company={editing} />
      <ConfirmDialog
        open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}
        title="Hapus badan usaha?"
        description={<>Data <strong>{deleting?.name}</strong> akan dihapus. Permohonan yang terhubung akan kehilangan tautan badan usahanya.</>}
        confirmLabel="Hapus" destructive
        onConfirm={async () => {
          const { error } = await supabase.from('companies').delete().eq('id', deleting!.id)
          if (error) { toast.error(errorMessage(error)); throw error }
          toast.success('Badan usaha dihapus.')
          qc.invalidateQueries({ queryKey: ['companies'] })
        }}
      />
    </div>
  )
}
