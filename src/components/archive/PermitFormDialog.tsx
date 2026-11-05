import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { PERMIT_STATUS } from '@/lib/constants'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { FormField } from '@/components/common/FormField'
import type { Permit } from '@/types'

const schema = z.object({
  permit_number: z.string().trim().min(1, 'Nomor izin wajib diisi').max(150),
  issued_date: z.string().optional(),
  valid_until: z.string().optional(),
  status: z.enum(['aktif', 'dicabut', 'kedaluwarsa', 'dibekukan']),
  signed_by: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
}).refine((v) => !v.valid_until || !v.issued_date || v.valid_until >= v.issued_date, { path: ['valid_until'], message: 'Tidak boleh sebelum tanggal penetapan' })
type Values = z.infer<typeof schema>

export function PermitFormDialog({
  open, onOpenChange, applicationId, permit, applicationStatus,
}: { open: boolean; onOpenChange: (o: boolean) => void; applicationId: string; permit?: Permit | null; applicationStatus?: string }) {
  const qc = useQueryClient()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      permit_number: permit?.permit_number ?? '', issued_date: permit?.issued_date ?? '', valid_until: permit?.valid_until ?? '',
      status: permit?.status ?? 'aktif', signed_by: permit?.signed_by ?? '', notes: permit?.notes ?? '',
    },
  })
  const m = useMutation({
    mutationFn: async (v: Values) => {
      const payload = {
        permit_number: v.permit_number, issued_date: v.issued_date || null, valid_until: v.valid_until || null,
        status: v.status, signed_by: v.signed_by || null, notes: v.notes || null,
      }
      if (permit) {
        const { error } = await supabase.from('permits').update(payload).eq('id', permit.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('permits').insert({ ...payload, application_id: applicationId })
        if (error) throw error
        if (applicationStatus === 'proses') {
          await supabase.from('applications').update({ status: 'terbit' }).eq('id', applicationId)
        }
      }
    },
    onSuccess: () => {
      toast.success(permit ? 'Data izin diperbarui.' : 'Izin terbit dicatat.')
      qc.invalidateQueries({ queryKey: ['application'] })
      qc.invalidateQueries({ queryKey: ['archive'] })
      onOpenChange(false)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const err = form.formState.errors
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form noValidate onSubmit={form.handleSubmit((v) => m.mutate(v))} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{permit ? 'Ubah data izin terbit' : 'Catat izin terbit'}</DialogTitle>
            {permit?.data_source === 'import' && <DialogDescription>Data dari SiCANTIK. Perubahan akan dilindungi dari penimpaan impor.</DialogDescription>}
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nomor izin" htmlFor="pf-no" required error={err.permit_number?.message} className="sm:col-span-2">
              <Input id="pf-no" {...form.register('permit_number')} />
            </FormField>
            <FormField label="Tanggal penetapan" htmlFor="pf-issued"><Input id="pf-issued" type="date" {...form.register('issued_date')} /></FormField>
            <FormField label="Berlaku sampai" htmlFor="pf-valid" error={err.valid_until?.message}><Input id="pf-valid" type="date" {...form.register('valid_until')} /></FormField>
            <FormField label="Status izin" htmlFor="pf-status">
              <NativeSelect id="pf-status" {...form.register('status')}>
                {Object.entries(PERMIT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </NativeSelect>
            </FormField>
            <FormField label="Pejabat penandatangan" htmlFor="pf-sign"><Input id="pf-sign" {...form.register('signed_by')} /></FormField>
            <FormField label="Catatan" htmlFor="pf-notes" className="sm:col-span-2"><Textarea id="pf-notes" rows={2} {...form.register('notes')} /></FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
            <Button type="submit" loading={m.isPending}>Simpan</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
