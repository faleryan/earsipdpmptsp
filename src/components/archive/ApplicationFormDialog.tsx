import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { UserPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { ACCESS_LEVELS, APPLICATION_STATUS, APPLICATION_TYPES } from '@/lib/constants'
import {
  getApplicantOption, getCompanyOption, getPermitTypeOption, listClassifications, searchApplicants, searchCompanies, searchPermitTypes,
} from '@/lib/api'
import { todayIso } from '@/lib/format'
import { useAuth } from '@/hooks/useAuth'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { FormField } from '@/components/common/FormField'
import { Combobox } from '@/components/common/Combobox'
import { ApplicantFormDialog } from '@/pages/ApplicantsPage'
import type { Application } from '@/types'

const schema = z.object({
  application_number: z.string().trim().min(1, 'Nomor permohonan wajib diisi').max(150),
  source_id: z.string().trim().max(100).optional(),
  permit_type_id: z.string({ required_error: 'Pilih jenis izin' }).min(1, 'Pilih jenis izin'),
  application_type: z.string().min(2),
  application_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal wajib diisi'),
  applicant_id: z.string({ required_error: 'Pilih pemohon' }).min(1, 'Pilih pemohon'),
  company_id: z.string().nullable().optional(),
  location: z.string().max(500).optional(),
  permit_location: z.string().max(500).optional(),
  status: z.enum(['proses', 'terbit', 'ditolak', 'dibatalkan']),
  classification_id: z.string().optional(),
  archive_code: z.string().trim().max(100).optional(),
  physical_location: z.string().trim().max(200).optional(),
  access_level: z.enum(['biasa', 'terbatas', 'rahasia']),
  notes: z.string().max(2000).optional(),
})
type Values = z.infer<typeof schema>

const SOURCE_FIELDS = new Set(['application_number', 'applicant_id', 'company_id', 'permit_type_id', 'application_type', 'application_date', 'location', 'permit_location', 'status'])

export function ApplicationFormDialog({ open, onOpenChange, application }: { open: boolean; onOpenChange: (o: boolean) => void; application?: Application | null }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { can } = useAuth()
  const [newApplicant, setNewApplicant] = useState(false)
  const classifications = useQuery({ queryKey: ['classifications'], queryFn: listClassifications })
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      application_number: application?.application_number ?? '',
      source_id: application?.source_id ?? '',
      permit_type_id: application?.permit_type_id ?? '',
      application_type: application?.application_type ?? 'Baru',
      application_date: application?.application_date ?? todayIso(),
      applicant_id: application?.applicant_id ?? '',
      company_id: application?.company_id ?? null,
      location: application?.location ?? '',
      permit_location: application?.permit_location ?? '',
      status: application?.status ?? 'proses',
      classification_id: application?.classification_id ?? '',
      archive_code: application?.archive_code ?? '',
      physical_location: application?.physical_location ?? '',
      access_level: application?.access_level ?? 'biasa',
      notes: application?.notes ?? '',
    },
  })
  const isImported = application?.data_source === 'import'

  const m = useMutation({
    mutationFn: async (v: Values) => {
      const payload: Record<string, unknown> = {
        application_number: v.application_number, permit_type_id: v.permit_type_id, application_type: v.application_type,
        application_date: v.application_date, applicant_id: v.applicant_id, company_id: v.company_id || null,
        location: v.location || null, permit_location: v.permit_location || null, status: v.status,
        classification_id: v.classification_id || null, archive_code: v.archive_code || null,
        physical_location: v.physical_location || null, access_level: v.access_level, notes: v.notes || null,
      }
      // klasifikasi default dari jenis izin bila kosong
      if (!payload.classification_id) {
        const { data } = await supabase.from('permit_types').select('classification_id').eq('id', v.permit_type_id).single()
        payload.classification_id = data?.classification_id ?? null
      }
      if (application) {
        const { error } = await supabase.from('applications').update(payload).eq('id', application.id)
        if (error) throw error
        return application.id
      }
      payload.source_id = v.source_id || null
      payload.source_system = 'SiCANTIK'
      const { data, error } = await supabase.from('applications').insert(payload).select('id').single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: (id) => {
      toast.success(application ? 'Permohonan diperbarui.' : 'Permohonan ditambahkan.')
      qc.invalidateQueries({ queryKey: ['archive'] })
      qc.invalidateQueries({ queryKey: ['application'] })
      onOpenChange(false)
      if (!application) navigate(`/permohonan/${id}`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const err = form.formState.errors
  const dirtySource = isImported && Object.keys(form.formState.dirtyFields).some((k) => SOURCE_FIELDS.has(k))

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="lg">
          <form noValidate onSubmit={form.handleSubmit((v) => m.mutate(v))} className="flex min-h-0 flex-col">
            <DialogHeader>
              <DialogTitle>{application ? 'Ubah data permohonan' : 'Tambah permohonan manual'}</DialogTitle>
              <DialogDescription>
                {application ? 'Perbarui data permohonan dan metadata arsip.' : 'Gunakan untuk arsip yang tidak berasal dari ekspor SiCANTIK.'}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-6">
              {dirtySource && (
                <p className="rounded-md border border-[#ecd3a6] bg-[#fffaf0] px-3 py-2 text-sm">
                  Anda mengubah data yang berasal dari SiCANTIK. Perubahan akan ditandai sebagai edit manual dan tidak ditimpa impor berikutnya tanpa konfirmasi.
                </p>
              )}
              <fieldset className="grid gap-4 sm:grid-cols-2">
                <legend className="mb-3 text-sm font-semibold text-muted-foreground">Data permohonan</legend>
                <FormField label="Nomor permohonan" htmlFor="af-no" required error={err.application_number?.message}>
                  <Input id="af-no" {...form.register('application_number')} aria-invalid={!!err.application_number} />
                </FormField>
                <FormField label="ID SiCANTIK" htmlFor="af-src" hint={application ? 'Tidak dapat diubah' : 'Opsional, untuk pencocokan impor'}>
                  <Input id="af-src" {...form.register('source_id')} disabled={!!application} />
                </FormField>
                <FormField label="Jenis izin" htmlFor="af-pt" required error={err.permit_type_id?.message} className="sm:col-span-2">
                  <Controller control={form.control} name="permit_type_id" render={({ field }) => (
                    <Combobox id="af-pt" queryKey="permit_types" value={field.value || null} onChange={(v) => field.onChange(v ?? '')}
                      fetchOptions={searchPermitTypes} fetchSelected={getPermitTypeOption} placeholder="Cari jenis izin…" invalid={!!err.permit_type_id} />
                  )} />
                </FormField>
                <FormField label="Jenis permohonan" htmlFor="af-type">
                  <NativeSelect id="af-type" {...form.register('application_type')}>
                    {Array.from(new Set([...APPLICATION_TYPES, form.getValues('application_type')])).map((t) => <option key={t} value={t}>{t}</option>)}
                  </NativeSelect>
                </FormField>
                <FormField label="Tanggal permohonan" htmlFor="af-date" required error={err.application_date?.message}>
                  <Input id="af-date" type="date" {...form.register('application_date')} />
                </FormField>
                <FormField label="Pemohon" htmlFor="af-ap" required error={err.applicant_id?.message} className="sm:col-span-2">
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <Controller control={form.control} name="applicant_id" render={({ field }) => (
                        <Combobox id="af-ap" queryKey="applicants" value={field.value || null} onChange={(v) => field.onChange(v ?? '')}
                          fetchOptions={searchApplicants} fetchSelected={getApplicantOption} placeholder="Cari nama atau NIK…" invalid={!!err.applicant_id} />
                      )} />
                    </div>
                    {can('archive.write') && <Button type="button" variant="outline" onClick={() => setNewApplicant(true)}><UserPlus /> Baru</Button>}
                  </div>
                </FormField>
                <FormField label="Badan usaha" htmlFor="af-co" className="sm:col-span-2" hint="Opsional">
                  <Controller control={form.control} name="company_id" render={({ field }) => (
                    <Combobox id="af-co" queryKey="companies" value={field.value ?? null} onChange={field.onChange}
                      fetchOptions={searchCompanies} fetchSelected={getCompanyOption} placeholder="Cari badan usaha…" allowClear />
                  )} />
                </FormField>
                <FormField label="Lokasi" htmlFor="af-loc"><Input id="af-loc" {...form.register('location')} /></FormField>
                <FormField label="Lokasi izin" htmlFor="af-ploc"><Input id="af-ploc" {...form.register('permit_location')} /></FormField>
                <FormField label="Status" htmlFor="af-status">
                  <NativeSelect id="af-status" {...form.register('status')}>
                    {Object.entries(APPLICATION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </NativeSelect>
                </FormField>
              </fieldset>

              <fieldset className="grid gap-4 border-t pt-5 sm:grid-cols-2">
                <legend className="mb-3 text-sm font-semibold text-muted-foreground">Metadata arsip</legend>
                <FormField label="Klasifikasi arsip" htmlFor="af-class" hint="Kosongkan untuk memakai klasifikasi default jenis izin">
                  <NativeSelect id="af-class" {...form.register('classification_id')}>
                    <option value="">— Default jenis izin —</option>
                    {classifications.data?.filter((c) => c.is_active || c.id === application?.classification_id).map((c) => (
                      <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label="Tingkat akses" htmlFor="af-access">
                  <NativeSelect id="af-access" {...form.register('access_level')}>
                    {ACCESS_LEVELS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </NativeSelect>
                </FormField>
                <FormField label="Kode / nomor arsip" htmlFor="af-code" hint="Nomor berkas internal, harus unik">
                  <Input id="af-code" {...form.register('archive_code')} />
                </FormField>
                <FormField label="Lokasi fisik" htmlFor="af-phys" hint="Contoh: Rak B-03, Boks 12">
                  <Input id="af-phys" {...form.register('physical_location')} />
                </FormField>
                <FormField label="Catatan" htmlFor="af-notes" className="sm:col-span-2"><Textarea id="af-notes" rows={2} {...form.register('notes')} /></FormField>
              </fieldset>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
              <Button type="submit" loading={m.isPending}>{application ? 'Simpan perubahan' : 'Tambah permohonan'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ApplicantFormDialog
        open={newApplicant}
        onOpenChange={setNewApplicant}
        onSaved={(a) => form.setValue('applicant_id', a.id, { shouldValidate: true, shouldDirty: true })}
      />
    </>
  )
}
