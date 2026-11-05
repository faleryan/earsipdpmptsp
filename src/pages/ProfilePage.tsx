import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { ROLE_LABELS } from '@/lib/constants'
import { useAuth } from '@/hooks/useAuth'
import { PageHeader } from '@/components/common/PageHeader'
import { FormField } from '@/components/common/FormField'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { passwordSchema } from './AuthPages'

const profileSchema = z.object({
  full_name: z.string().trim().min(2, 'Nama wajib diisi').max(150),
  nip: z.string().trim().regex(/^([0-9 ]{8,25})?$/, 'NIP hanya angka (8–25 digit)').optional(),
  position: z.string().trim().max(150).optional(),
  phone: z.string().trim().max(30).optional(),
})
const pwSchema = z.object({ current: z.string().min(1, 'Wajib diisi'), password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Konfirmasi tidak sama' })

export default function ProfilePage() {
  const { profile, role, refreshProfile } = useAuth()
  const pf = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    values: { full_name: profile?.full_name ?? '', nip: profile?.nip ?? '', position: profile?.position ?? '', phone: profile?.phone ?? '' },
  })
  const pw = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema) })

  return (
    <div>
      <PageHeader title="Profil saya" description={`${profile?.email} · ${role ? ROLE_LABELS[role] : ''} · terakhir masuk ${formatDateTime(profile?.last_login_at)}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Data diri</CardTitle><CardDescription>Peran dan status akun hanya dapat diubah Super Admin.</CardDescription></CardHeader>
          <CardContent>
            <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={pf.handleSubmit(async (v) => {
              const { error } = await supabase.from('profiles').update({ full_name: v.full_name, nip: v.nip || null, position: v.position || null, phone: v.phone || null }).eq('id', profile!.id)
              if (error) return void toast.error(errorMessage(error))
              toast.success('Profil disimpan.')
              await refreshProfile()
            })}>
              <FormField label="Nama lengkap" htmlFor="p-name" required error={pf.formState.errors.full_name?.message} className="sm:col-span-2"><Input id="p-name" {...pf.register('full_name')} /></FormField>
              <FormField label="NIP" htmlFor="p-nip" error={pf.formState.errors.nip?.message}><Input id="p-nip" {...pf.register('nip')} /></FormField>
              <FormField label="Jabatan" htmlFor="p-pos"><Input id="p-pos" {...pf.register('position')} /></FormField>
              <FormField label="Telepon" htmlFor="p-phone"><Input id="p-phone" {...pf.register('phone')} /></FormField>
              <div className="sm:col-span-2"><Button type="submit" loading={pf.formState.isSubmitting}>Simpan profil</Button></div>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Ganti kata sandi</CardTitle><CardDescription>Minimal 10 karakter dengan huruf besar, huruf kecil, dan angka.</CardDescription></CardHeader>
          <CardContent>
            <form noValidate className="space-y-4" onSubmit={pw.handleSubmit(async (v) => {
              // verifikasi kata sandi lama
              const { error: authErr } = await supabase.auth.signInWithPassword({ email: profile!.email, password: v.current })
              if (authErr) return void pw.setError('current', { message: 'Kata sandi saat ini salah' })
              const { error } = await supabase.auth.updateUser({ password: v.password })
              if (error) return void toast.error(errorMessage(error))
              toast.success('Kata sandi diganti.')
              pw.reset({ current: '', password: '', confirm: '' })
            })}>
              <FormField label="Kata sandi saat ini" htmlFor="pw-cur" error={pw.formState.errors.current?.message}><Input id="pw-cur" type="password" autoComplete="current-password" {...pw.register('current')} /></FormField>
              <FormField label="Kata sandi baru" htmlFor="pw-new" error={pw.formState.errors.password?.message}><Input id="pw-new" type="password" autoComplete="new-password" {...pw.register('password')} /></FormField>
              <FormField label="Ulangi kata sandi baru" htmlFor="pw-conf" error={pw.formState.errors.confirm?.message}><Input id="pw-conf" type="password" autoComplete="new-password" {...pw.register('confirm')} /></FormField>
              <Button type="submit" loading={pw.formState.isSubmitting}>Ganti kata sandi</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
