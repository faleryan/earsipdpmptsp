import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { DOCUMENT_CATEGORIES, SECTORS } from '@/lib/constants'
import { listClassifications } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { PageHeader } from '@/components/common/PageHeader'
import { DataTable, type Column } from '@/components/common/DataTable'
import { SearchInput } from '@/components/common/SearchInput'
import { EmptyState } from '@/components/common/States'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { FormField } from '@/components/common/FormField'
import { DocumentTabs } from '@/components/common/DocumentTabs'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { DocumentCategory, PermitType } from '@/types'

type Row = PermitType & { applications: { count: number }[] }

const schema = z.object({
  name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(300),
  code: z.string().trim().max(50).optional(),
  sector: z.string().trim().min(2, 'Sektor wajib diisi'),
  classification_id: z.string().optional(),
  validity_years: z.string().regex(/^(\d{1,2})?$/, 'Isi angka tahun').optional(),
  required_documents: z.array(z.string()),
  description: z.string().max(1000).optional(),
  is_active: z.boolean(),
  report_group: z.string().max(200).optional(),
  report_order: z.string().regex(/^-?\d{0,4}$/, 'Isi angka').optional(),
  recalc_overwrite: z.boolean(),
})
type FormValues = z.infer<typeof schema>

function PermitTypeDialog({ open, onOpenChange, item, groups }: { open: boolean; onOpenChange: (o: boolean) => void; item?: PermitType | null; groups: string[] }) {
  const qc = useQueryClient()
  const classifications = useQuery({ queryKey: ['classifications'], queryFn: listClassifications })
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: {
      name: item?.name ?? '', code: item?.code ?? '', sector: item?.sector ?? 'Kesehatan',
      classification_id: item?.classification_id ?? '', validity_years: item?.validity_years?.toString() ?? '',
      required_documents: item?.required_documents ?? ['surat_permohonan', 'identitas_pemohon', 'dokumen_persyaratan', 'surat_keputusan'],
      description: item?.description ?? '', is_active: item?.is_active ?? true,
      report_group: item?.report_group ?? '', report_order: String(item?.report_order ?? 0), recalc_overwrite: false,
    },
  })
  const mutation = useMutation({
    mutationFn: async (v: FormValues) => {
      const payload = {
        name: v.name, code: v.code || null, sector: v.sector, classification_id: v.classification_id || null,
        validity_years: v.validity_years ? Number(v.validity_years) : null,
        required_documents: v.required_documents, description: v.description || null, is_active: v.is_active,
        report_group: v.report_group?.trim() || null, report_order: Number(v.report_order || 0),
      }
      const res = item
        ? await supabase.from('permit_types').update(payload).eq('id', item.id).select('id').single()
        : await supabase.from('permit_types').insert(payload).select('id').single()
      if (res.error) throw res.error
      // Masa berlaku izin yang sudah terbit dihitung ulang bila masa berlaku jenis izin diisi/diubah
      const changed = payload.validity_years !== (item?.validity_years ?? null) || v.recalc_overwrite
      if (payload.validity_years && changed) {
        const { data, error } = await supabase.rpc('recalculate_permit_validity', { p_permit_type_id: res.data.id, p_overwrite: v.recalc_overwrite })
        if (error) throw error
        return data as number
      }
      return null
    },
    onSuccess: (n) => {
      toast.success(item ? 'Jenis izin diperbarui.' : 'Jenis izin ditambahkan.')
      if (n !== null) toast.info(`Tanggal berakhir ${n} izin terbit dihitung dari masa berlaku.`)
      qc.invalidateQueries({ queryKey: ['expiry'] })
      qc.invalidateQueries({ queryKey: ['permit_types'] })
      onOpenChange(false)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const err = form.formState.errors
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form noValidate onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="flex min-h-0 flex-col">
          <DialogHeader><DialogTitle>{item ? 'Ubah jenis perizinan' : 'Tambah jenis perizinan'}</DialogTitle></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nama jenis izin" htmlFor="pt-name" required error={err.name?.message} className="sm:col-span-2"
              hint={item?.source_name && item.source_name !== item.name ? `Nama di SiCANTIK: ${item.source_name}` : 'Harus sama persis dengan nama di SiCANTIK agar impor tidak membuat jenis baru.'}>
              <Input id="pt-name" {...form.register('name')} aria-invalid={!!err.name} />
            </FormField>
            <FormField label="Kode singkat" htmlFor="pt-code" hint="Contoh: SIP-PV"><Input id="pt-code" {...form.register('code')} /></FormField>
            <FormField label="Sektor" htmlFor="pt-sector" required error={err.sector?.message}>
              <Input id="pt-sector" list="sector-list" {...form.register('sector')} />
              <datalist id="sector-list">{SECTORS.map((s) => <option key={s} value={s} />)}</datalist>
            </FormField>
            <FormField label="Klasifikasi arsip default" htmlFor="pt-class">
              <NativeSelect id="pt-class" {...form.register('classification_id')}>
                <option value="">— Belum ditentukan —</option>
                {classifications.data?.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </NativeSelect>
            </FormField>
            <FormField label="Masa berlaku (tahun)" htmlFor="pt-valid" error={err.validity_years?.message} hint="Dipakai menghitung tanggal berakhir izin & notifikasi masa berlaku. Kosongkan bila tidak ada.">
              <Input id="pt-valid" inputMode="numeric" {...form.register('validity_years')} />
            </FormField>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <Controller control={form.control} name="recalc_overwrite" render={({ field }) => <Checkbox className="mt-0.5" checked={field.value} onCheckedChange={(v) => field.onChange(!!v)} />} />
              <span>Hitung ulang juga izin yang sudah punya tanggal berakhir <span className="text-muted-foreground">(tanggal yang pernah diubah manual tetap tidak disentuh)</span></span>
            </label>
            <FormField label="Kelompok laporan rekap" htmlFor="pt-group" hint="Mis. “PERIZINAN BERUSAHA BERBASIS RISIKO”. Kosong = dikelompokkan per sektor saja.">
              <Input id="pt-group" list="group-list" {...form.register('report_group')} />
              <datalist id="group-list">{groups.map((g) => <option key={g} value={g} />)}</datalist>
            </FormField>
            <FormField label="Urutan di laporan" htmlFor="pt-order" error={err.report_order?.message}><Input id="pt-order" inputMode="numeric" {...form.register('report_order')} /></FormField>
            <div className="sm:col-span-2">
              <p className="mb-2 text-sm font-medium">Dokumen wajib dalam berkas</p>
              <Controller
                control={form.control}
                name="required_documents"
                render={({ field }) => (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {DOCUMENT_CATEGORIES.map((c) => (
                      <label key={c.value} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                        <Checkbox
                          checked={field.value.includes(c.value)}
                          onCheckedChange={(v) => field.onChange(v ? [...field.value, c.value] : field.value.filter((x) => x !== c.value))}
                        />
                        {c.label}
                      </label>
                    ))}
                  </div>
                )}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">Menentukan status kelengkapan berkas di dashboard dan pencarian.</p>
            </div>
            <FormField label="Keterangan" htmlFor="pt-desc" className="sm:col-span-2"><Textarea id="pt-desc" rows={2} {...form.register('description')} /></FormField>
            <label className="flex items-center gap-3 text-sm sm:col-span-2">
              <Controller control={form.control} name="is_active" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
              Aktif (tampil sebagai pilihan saat input permohonan)
            </label>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
            <Button type="submit" loading={mutation.isPending}>{item ? 'Simpan perubahan' : 'Tambah jenis izin'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function PermitTypesPage() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [sector, setSector] = useState('')
  const [editing, setEditing] = useState<PermitType | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const list = useQuery({
    queryKey: ['permit_types', 'with-count'],
    queryFn: async () => {
      const { data, error } = await supabase.from('permit_types').select('*, classification:classifications(id, code, name), applications(count)').order('name')
      if (error) throw error
      return data as Row[]
    },
  })
  const sectors = useMemo(() => Array.from(new Set(list.data?.map((r) => r.sector))).sort(), [list.data])
  const rows = useMemo(() => list.data?.filter((r) =>
    (!sector || r.sector === sector) && (!search || `${r.name} ${r.code ?? ''}`.toLowerCase().includes(search.toLowerCase()))), [list.data, search, sector])

  const columns: Column<Row>[] = [
    {
      key: 'name', header: 'Jenis perizinan',
      cell: (r) => (
        <div className="min-w-64">
          <p className="font-medium">{r.name}</p>
          <p className="text-xs text-muted-foreground">{[r.code, r.validity_years ? `berlaku ${r.validity_years} tahun` : 'tanpa masa berlaku', r.report_group].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    { key: 'sector', header: 'Sektor', cell: (r) => <Badge variant="outline">{r.sector}</Badge> },
    { key: 'classification', header: 'Klasifikasi', cell: (r) => r.classification ? <span className="text-sm">{r.classification.code}</span> : <span className="text-muted-foreground">—</span> },
    { key: 'required', header: 'Dokumen wajib', cell: (r) => <DocumentTabs required={r.required_documents as DocumentCategory[]} present={[]} /> },
    { key: 'count', header: 'Permohonan', cell: (r) => <Link className="font-semibold tabular text-primary hover:underline" to={`/pencarian?permitTypeId=${r.id}`}>{r.applications?.[0]?.count ?? 0}</Link> },
    { key: 'is_active', header: 'Status', cell: (r) => r.is_active ? <Badge variant="success">Aktif</Badge> : <Badge variant="muted">Nonaktif</Badge> },
    {
      key: 'actions', header: <span className="sr-only">Aksi</span>, className: 'text-right whitespace-nowrap',
      cell: (r) => can('master.manage') && (
        <>
          <Button variant="ghost" size="icon-sm" aria-label="Ubah" onClick={() => setEditing(r)}><Pencil /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Hapus" onClick={() => setDeleting(r)}><Trash2 /></Button>
        </>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Jenis perizinan"
        description="Jenis izin terbentuk otomatis dari impor SiCANTIK. Atur sektor, klasifikasi default, dan dokumen wajib di sini."
        actions={can('master.manage') && <Button onClick={() => setEditing(null)}><Plus /> Tambah jenis izin</Button>}
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
          <SearchInput value={search} onChange={setSearch} placeholder="Cari nama atau kode" className="sm:w-96" />
          <NativeSelect aria-label="Sektor" className="sm:w-48" value={sector} onChange={(e) => setSector(e.target.value)}>
            <option value="">Semua sektor</option>
            {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
          </NativeSelect>
        </div>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
          empty={<EmptyState title="Belum ada jenis perizinan" description="Lakukan impor SiCANTIK atau tambahkan secara manual." />}
          footer={<p className="border-t px-4 py-3 text-sm text-muted-foreground">{rows?.length ?? 0} jenis izin</p>} />
      </Card>
      <PermitTypeDialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} item={editing}
        groups={Array.from(new Set((list.data ?? []).map((r) => r.report_group).filter((g): g is string => !!g)))} />
      <ConfirmDialog
        open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}
        title="Hapus jenis izin?"
        description={<>Jenis izin <strong>{deleting?.name}</strong> hanya dapat dihapus bila belum dipakai permohonan. Untuk menyembunyikan, nonaktifkan saja.</>}
        confirmLabel="Hapus" destructive
        onConfirm={async () => {
          const { error } = await supabase.from('permit_types').delete().eq('id', deleting!.id)
          if (error) { toast.error(errorMessage(error)); throw error }
          toast.success('Jenis izin dihapus.')
          qc.invalidateQueries({ queryKey: ['permit_types'] })
        }}
      />
    </div>
  )
}
