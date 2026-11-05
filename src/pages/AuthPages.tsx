import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Clock, LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { errorMessage } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/common/FormField'
import { BrandMark } from '@/components/layout/Sidebar'

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="relative hidden overflow-hidden bg-navy px-12 py-10 text-white lg:flex lg:flex-col">
        <BrandMark />
        <div className="mt-auto max-w-md">
          <h1 className="text-[2rem] font-bold leading-[1.15]">Arsip perizinan Kabupaten Belu, tersimpan rapi dan mudah ditemukan.</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-navy-text">
            Data permohonan dan izin terbit dari SiCANTIK Cloud dihimpun bersama dokumen PDF-nya,
            lengkap dengan klasifikasi, riwayat perubahan, dan laporan.
          </p>
        </div>
        {/* Motif tab map arsip */}
        <div className="mt-12 flex items-end gap-2" aria-hidden>
          {['Permohonan', 'Identitas', 'Persyaratan', 'Rekomendasi', 'Berita acara', 'SK / Izin', 'Pendukung'].map((t, i) => (
            <div key={t} className="flex flex-col items-center gap-1.5">
              <div className={i < 5 ? 'h-8 w-12 rounded-t-md bg-[#1f6fd1]' : 'h-8 w-12 rounded-t-md border border-dashed border-[#5f7fa8]'} />
              <span className="text-[10px] text-[#7f95b5]">{t}</span>
            </div>
          ))}
        </div>
        <p className="mt-8 text-xs text-[#7f95b5]">Dinas Penanaman Modal dan Pelayanan Terpadu Satu Pintu Kabupaten Belu</p>
      </section>
      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="inline-flex rounded-xl bg-navy p-3"><BrandMark /></div>
          </div>
          <h2 className="text-2xl font-bold">{title}</h2>
          {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </section>
    </div>
  )
}

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email wajib diisi').email('Format email tidak valid'),
  password: z.string().min(1, 'Kata sandi wajib diisi'),
})

export function LoginPage() {
  const { session, signIn, loading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/'

  if (!loading && session) return <Navigate to={from} replace />

  return (
    <AuthShell title="Masuk" subtitle="Gunakan akun yang diberikan Super Admin.">
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null)
          try {
            await signIn(v.email, v.password)
            navigate(from, { replace: true })
          } catch (e) {
            setError(errorMessage(e))
          }
        })}
      >
        {error && <p role="alert" className="rounded-md border border-[#f1c3bf] bg-[#fdf0ef] px-3 py-2 text-sm text-destructive">{error}</p>}
        <FormField label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="username" autoFocus {...form.register('email')} aria-invalid={!!form.formState.errors.email} />
        </FormField>
        <FormField label="Kata sandi" htmlFor="password" error={form.formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} aria-invalid={!!form.formState.errors.password} />
        </FormField>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>Masuk</Button>
        <p className="text-center text-sm">
          <Link to="/lupa-sandi" className="text-primary hover:underline">Lupa kata sandi?</Link>
        </p>
      </form>
    </AuthShell>
  )
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: z.string().trim().email('Format email tidak valid') })) })
  return (
    <AuthShell title="Atur ulang kata sandi" subtitle="Kami akan mengirim tautan pengaturan kata sandi ke email Anda.">
      {sent ? (
        <div className="space-y-4">
          <p className="rounded-md bg-accent px-3 py-3 text-sm">Jika email terdaftar, tautan sudah dikirim. Periksa kotak masuk dan folder spam.</p>
          <Button asChild variant="outline" className="w-full"><Link to="/masuk">Kembali ke halaman masuk</Link></Button>
        </div>
      ) : (
        <form
          noValidate
          className="space-y-4"
          onSubmit={form.handleSubmit(async ({ email }) => {
            const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/atur-sandi` })
            if (error) toast.error(errorMessage(error))
            else setSent(true)
          })}
        >
          <FormField label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
          </FormField>
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>Kirim tautan</Button>
          <p className="text-center text-sm"><Link to="/masuk" className="text-primary hover:underline">Kembali ke halaman masuk</Link></p>
        </form>
      )}
    </AuthShell>
  )
}

export const passwordSchema = z
  .string()
  .min(10, 'Minimal 10 karakter')
  .regex(/[a-z]/, 'Harus memuat huruf kecil')
  .regex(/[A-Z]/, 'Harus memuat huruf besar')
  .regex(/[0-9]/, 'Harus memuat angka')

export function UpdatePasswordPage() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setReady(Boolean(data.session)))
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY' || s) setReady(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])
  const schema = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, {
    path: ['confirm'], message: 'Konfirmasi kata sandi tidak sama',
  })
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) })
  return (
    <AuthShell title="Buat kata sandi baru" subtitle="Minimal 10 karakter dengan huruf besar, huruf kecil, dan angka.">
      {!ready ? (
        <p className="text-sm text-muted-foreground">Membuka tautan… Jika halaman ini tidak berubah, minta tautan baru dari halaman lupa kata sandi.</p>
      ) : (
        <form
          noValidate
          className="space-y-4"
          onSubmit={form.handleSubmit(async ({ password }) => {
            const { error } = await supabase.auth.updateUser({ password })
            if (error) return void toast.error(errorMessage(error))
            toast.success('Kata sandi diperbarui.')
            navigate('/', { replace: true })
          })}
        >
          <FormField label="Kata sandi baru" htmlFor="pw" error={form.formState.errors.password?.message}>
            <Input id="pw" type="password" autoComplete="new-password" {...form.register('password')} />
          </FormField>
          <FormField label="Ulangi kata sandi" htmlFor="pw2" error={form.formState.errors.confirm?.message}>
            <Input id="pw2" type="password" autoComplete="new-password" {...form.register('confirm')} />
          </FormField>
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>Simpan kata sandi</Button>
        </form>
      )}
    </AuthShell>
  )
}

export function InactiveAccountPage() {
  const { profile, signOut, refreshProfile } = useAuth()
  return (
    <AuthShell title="Akun menunggu aktivasi" subtitle={profile?.email}>
      <div className="space-y-4">
        <div className="flex gap-3 rounded-md border bg-card p-4 text-sm">
          <Clock className="mt-0.5 size-5 shrink-0 text-warning" />
          <p>Akun Anda sudah terdaftar tetapi belum diaktifkan atau belum diberi peran. Hubungi Super Admin DPMPTSP Kabupaten Belu untuk aktivasi.</p>
        </div>
        <Button variant="outline" className="w-full" onClick={() => void refreshProfile()}>Periksa ulang status</Button>
        <Button variant="ghost" className="w-full" onClick={() => void signOut()}><LogOut /> Keluar</Button>
      </div>
    </AuthShell>
  )
}

export function ConfigMissingPage() {
  return (
    <AuthShell title="Konfigurasi belum lengkap" subtitle="Aplikasi belum terhubung ke Supabase.">
      <div className="space-y-3 text-sm">
        <p>Isi variabel lingkungan berikut, lalu jalankan ulang atau deploy ulang aplikasi:</p>
        <pre className="overflow-x-auto rounded-md bg-navy p-3 text-xs text-white">VITE_SUPABASE_URL=…{'\n'}VITE_SUPABASE_ANON_KEY=…</pre>
        <p className="text-muted-foreground">Lokal: file <code>.env.local</code>. Vercel: Project Settings → Environment Variables. Lihat README bagian instalasi.</p>
      </div>
    </AuthShell>
  )
}
