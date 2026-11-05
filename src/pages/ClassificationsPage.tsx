import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2, Wand2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { ACCESS_LEVELS, FINAL_DISPOSITION, accessLabel } from '@/lib/constants'
import { formatNumber } from '@/lib/format'
import { useAuth } from '@/hooks/useAuth'
import { PageHeader } from '@/components/common/PageHeader'
import { DataTable, type Column } from '@/components/common/DataTable'
import { EmptyState } from '@/components/common/States'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { FormField } from '@/components/common/FormField'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Classification } from '@/types'

type Row = Classification & { applications: { count: number }[] }

const schema = z.object({
  code: z.string().trim().min(1, 'Kode wajib diisi').max(50),
  name: z.string().trim().min(2, 'Nama wajib diisi').max(200),
  description: z.string().max(1000).optional(),
  parent_id: z.string().optional(),
  retention_active_years: z.coerce.number().int().min(0).max(100),
  retention_inactive_years: z.coerce.number().int().min(0).max(100),
  final_disposition: z.enum(['musnah', 'permanen', 'dinilai_kembali']),
  security_level: z.enum(['biasa', 'terbatas', 'rahasia']),
  is_active: z.boolean(),
})
type FormIn = z.input<typeof schema>
type FormOut = z.output<typeof schema>

function ClassificationDialog({ open, onOpenChange, item, all }: { open: boolean; onOpenChange: (o: boolean) => void; item?: Classification | null; all: Classification[] }) {
  const qc = useQueryClient()
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    values: {
      code: item?.code ?? '', name: item?.name ?? '', description: item?.description ?? '', parent_id: item?.parent_id ?? '',
      retention_active_years: item?.retention_active_years ?? 2, retention_inactive_years: item?.retention_inactive_years ?? 5,
      final_disposition: item?.final_disposition ?? 'dinilai_kembali', security_level: item?.security_level ?? 'biasa', is_active: item?.is_active ?? true,
    },
  })
  const mutation = useMutation({
    mutationFn: async (v: FormOut) => {
      const payload = { ...v, parent_id: v.parent_id || null, description: v.description || null }
      const res = item ? await supabase.from('classifications').update(payload).eq('id', item.id) : await supabase.from('classifications').insert(payload)
      if (res.error) throw res.error
    },
    onSuccess: () => {
      toast.success(item ? 'Klasifikasi diperbarui.' : 'Klasifikasi ditambahkan.')
      qc.invalidateQueries({ queryKey: ['classifications'] })
      onOpenChange(false)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const err = form.formState.errors
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form noValidate onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="flex min-h-0 flex-col">
          <DialogHeader><DialogTitle>{item ? 'Ubah klasifikasi' : 'Tambah klasifikasi'}</DialogTitle></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <FormField label="Kode klasifikasi" htmlFor="cl-code" required error={err.code?.message}><Input id="cl-code" {...form.register('code')} /></FormField>
            <FormField label="Induk" htmlFor="cl-parent">
              <NativeSelect id="cl-parent" {...form.register('parent_id')}>
                <option value="">— Tanpa induk —</option>
                {all.filter((c) => c.id !== item?.id).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </NativeSelect>
            </FormField>
            <FormField label="Nama" htmlFor="cl-name" required error={err.name?.message} className="sm:col-span-2"><Input id="cl-name" {...form.register('name')} /></FormField>
            <FormField label="Retensi aktif (tahun)" htmlFor="cl-ra" error={err.retention_active_years?.message}><Input id="cl-ra" type="number" min={0} {...form.register('retention_active_years')} /></FormField>
            <FormField label="Retensi inaktif (tahun)" htmlFor="cl-ri" error={err.retention_inactive_years?.message}><Input id="cl-ri" type="number" min={0} {...form.register('retention_inactive_years')} /></FormField>
            <FormField label="Keterangan akhir" htmlFor="cl-fd">
              <NativeSelect id="cl-fd" {...form.register('final_disposition')}>
                {Object.entries(FINAL_DISPOSITION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </NativeSelect>
            </FormField>
            <FormField label="Tingkat keamanan" htmlFor="cl-sl">
              <NativeSelect id="cl-sl" {...form.register('security_level')}>
                {ACCESS_LEVELS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </NativeSelect>
            </FormField>
            <FormField label="Keterangan" htmlFor="cl-desc" className="sm:col-span-2"><Textarea id="cl-desc" rows={2} {...form.register('description')} /></FormField>
            <label className="flex items-center gap-3 text-sm sm:col-span-2">
              <Controller control={form.control} name="is_active" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
              Aktif
            </label>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
            <Button type="submit" loading={mutation.isPending}>{item ? 'Simpan perubahan' : 'Tambah klasifikasi'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function ClassificationsPage() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Classification | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [applying, setApplying] = useState(false)
  const list = useQuery({
    queryKey: ['classifications', 'with-count'],
    queryFn: async () => {
      const { data, error } = await supabase.from('classifications').select('*, applications(count)').order('code')
      if (error) throw error
      return data as Row[]
    },
  })
  const unclassified = useQuery({
    queryKey: ['classifications', 'unclassified'],
    queryFn: async () => {
      const { count, error } = await supabase.from('applications').select('id', { count: 'exact', head: true }).is('classification_id', null)
      if (error) throw error
      return count ?? 0
    },
  })
  const parentMap = useMemo(() => Object.fromEntries((list.data ?? []).map((c) => [c.id, c])), [list.data])

  const applyDefaults = async () => {
    const { data: types, error } = await supabase.from('permit_types').select('id, classification_id').not('classification_id', 'is', null)
    if (error) throw error
    let total = 0
    for (const t of types) {
      const { count, error: e } = await supabase.from('applications')
        .update({ classification_id: t.classification_id }, { count: 'exact' })
        .eq('permit_type_id', t.id).is('classification_id', null)
      if (e) throw e
      total += count ?? 0
    }
    toast.success(`${formatNumber(total)} arsip diklasifikasikan.`)
    qc.invalidateQueries({ queryKey: ['classifications'] })
  }

  const columns: Column<Row>[] = [
    {
      key: 'code', header: 'Kode',
      cell: (r) => <span className={r.parent_id ? 'pl-4 font-medium tabular' : 'font-semibold tabular'}>{r.code}</span>,
    },
    { key: 'name', header: 'Nama', cell: (r) => <div className="min-w-52"><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.parent_id ? `Induk: ${parentMap[r.parent_id]?.code ?? '—'}` : r.description ?? ''}</p></div> },
    { key: 'retention', header: 'Retensi aktif / inaktif', cell: (r) => <span className="tabular">{r.retention_active_years} / {r.retention_inactive_years} tahun</span> },
    { key: 'disposition', header: 'Keterangan akhir', cell: (r) => FINAL_DISPOSITION[r.final_disposition] },
    { key: 'security', header: 'Keamanan', cell: (r) => <Badge variant={r.security_level === 'biasa' ? 'muted' : r.security_level === 'rahasia' ? 'danger' : 'warning'}>{accessLabel(r.security_level)}</Badge> },
    { key: 'count', header: 'Arsip', cell: (r) => <Link className="font-semibold tabular text-primary hover:underline" to={`/pencarian?classificationId=${r.id}`}>{r.applications?.[0]?.count ?? 0}</Link> },
    { key: 'active', header: 'Status', cell: (r) => r.is_active ? <Badge variant="success">Aktif</Badge> : <Badge variant="muted">Nonaktif</Badge> },
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
        title="Klasifikasi arsip"
        description="Kode klasifikasi dan jadwal retensi arsip. Sesuaikan dengan Klasifikasi Arsip dan JRA resmi Pemerintah Kabupaten Belu."
        actions={can('master.manage') && (
          <>
            <Button variant="outline" onClick={() => setApplying(true)} disabled={!unclassified.data}><Wand2 /> Klasifikasikan otomatis</Button>
            <Button onClick={() => setEditing(null)}><Plus /> Tambah klasifikasi</Button>
          </>
        )}
      />
      {Boolean(unclassified.data) && (
        <p className="mb-3 rounded-md border border-[#ecd3a6] bg-[#fffaf0] px-3 py-2 text-sm">
          <strong className="tabular">{formatNumber(unclassified.data)}</strong> arsip belum diklasifikasikan.{' '}
          <Link to="/pencarian?classificationId=none" className="text-primary hover:underline">Lihat daftarnya</Link>.
        </p>
      )}
      <Card>
        <DataTable columns={columns} rows={list.data} rowKey={(r) => r.id} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
          empty={<EmptyState title="Belum ada klasifikasi" description="Tambahkan kode klasifikasi arsip." />} />
      </Card>
      <ClassificationDialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} item={editing} all={list.data ?? []} />
      <ConfirmDialog
        open={applying} onOpenChange={setApplying}
        title="Klasifikasikan otomatis?"
        description="Arsip yang belum memiliki klasifikasi akan diberi klasifikasi default dari jenis izinnya. Arsip yang sudah diklasifikasikan tidak diubah."
        confirmLabel="Terapkan"
        onConfirm={async () => {
          try { await applyDefaults() } catch (e) { toast.error(errorMessage(e)); throw e }
        }}
      />
      <ConfirmDialog
        open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}
        title="Hapus klasifikasi?"
        description={<>Klasifikasi <strong>{deleting?.code}</strong> akan dihapus. Arsip dan jenis izin yang memakainya menjadi belum diklasifikasikan.</>}
        confirmLabel="Hapus" destructive
        onConfirm={async () => {
          const { error } = await supabase.from('classifications').delete().eq('id', deleting!.id)
          if (error) { toast.error(errorMessage(error)); throw error }
          toast.success('Klasifikasi dihapus.')
          qc.invalidateQueries({ queryKey: ['classifications'] })
        }}
      />
    </div>
  )
}
