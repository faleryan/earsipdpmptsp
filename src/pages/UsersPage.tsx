import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, KeyRound, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { formatDateTime, formatRelative } from '@/lib/format'
import { useAuth } from '@/hooks/useAuth'
import { PageHeader } from '@/components/common/PageHeader'
import { DataTable, type Column } from '@/components/common/DataTable'
import { SearchInput } from '@/components/common/SearchInput'
import { EmptyState } from '@/components/common/States'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { FormField } from '@/components/common/FormField'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { passwordSchema } from './AuthPages'
import type { Profile, Role } from '@/types'

async function callAdmin(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    // ambil pesan dari body respons fungsi
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      const j = await ctx.json().catch(() => null)
      if (j?.error) throw new Error(j.error)
    }
    throw error
  }
  if (data?.error) throw new Error(data.error)
  return data
}

function generatePassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789']
  const all = sets.join('') + '!@#%'
  const rand = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length]
  const chars = [...sets.map(rand), ...Array.from({ length: 11 }, () => rand(all))]
  return chars.sort(() => crypto.getRandomValues(new Int8Array(1))[0]).join('')
}

const createSchema = z.object({
  full_name: z.string().trim().min(2, 'Nama wajib diisi'),
  email: z.string().trim().email('Format email tidak valid'),
  role_code: z.enum(['super_admin', 'admin_arsip', 'operator', 'pimpinan']),
  nip: z.string().trim().regex(/^([0-9 ]{8,25})?$/, 'NIP hanya angka (8–25 digit)').optional(),
  position: z.string().trim().max(150).optional(),
  phone: z.string().trim().max(30).optional(),
  password: passwordSchema,
})
type CreateValues = z.infer<typeof createSchema>

function CreateUserDialog({ open, onOpenChange, roles }: { open: boolean; onOpenChange: (o: boolean) => void; roles: Role[] }) {
  const qc = useQueryClient()
  const form = useForm<CreateValues>({ resolver: zodResolver(createSchema), defaultValues: { role_code: 'operator', password: generatePassword() } })
  const m = useMutation({
    mutationFn: (v: CreateValues) => callAdmin({ action: 'create', ...v }),
    onSuccess: (_, v) => {
      toast.success(`Akun ${v.email} dibuat. Sampaikan kata sandi awal secara langsung dan minta pengguna menggantinya.`)
      qc.invalidateQueries({ queryKey: ['profiles'] })
      form.reset({ role_code: 'operator', password: generatePassword() })
      onOpenChange(false)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const err = form.formState.errors
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form noValidate onSubmit={form.handleSubmit((v) => m.mutate(v))} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Tambah pengguna</DialogTitle>
            <DialogDescription>Akun langsung aktif. Pendaftaran mandiri dinonaktifkan demi keamanan.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nama lengkap" htmlFor="u-name" required error={err.full_name?.message} className="sm:col-span-2"><Input id="u-name" {...form.register('full_name')} /></FormField>
            <FormField label="Email" htmlFor="u-email" required error={err.email?.message}><Input id="u-email" type="email" autoComplete="off" {...form.register('email')} /></FormField>
            <FormField label="Peran" htmlFor="u-role" required>
              <NativeSelect id="u-role" {...form.register('role_code')}>{roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</NativeSelect>
            </FormField>
            <FormField label="NIP" htmlFor="u-nip" error={err.nip?.message}><Input id="u-nip" inputMode="numeric" {...form.register('nip')} /></FormField>
            <FormField label="Jabatan" htmlFor="u-pos"><Input id="u-pos" {...form.register('position')} /></FormField>
            <FormField label="Telepon" htmlFor="u-phone"><Input id="u-phone" {...form.register('phone')} /></FormField>
            <FormField label="Kata sandi awal" htmlFor="u-pw" required error={err.password?.message} hint="Dibuat acak; dapat diganti.">
              <div className="flex gap-2">
                <Input id="u-pw" autoComplete="new-password" className="font-mono" {...form.register('password')} />
                <Button type="button" variant="outline" onClick={() => form.setValue('password', generatePassword(), { shouldValidate: true })}>Acak</Button>
              </div>
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
            <Button type="submit" loading={m.isPending}>Buat akun</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditUserDialog({ user, onOpenChange }: { user: Profile | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const form = useForm({ values: { full_name: user?.full_name ?? '', nip: user?.nip ?? '', position: user?.position ?? '', phone: user?.phone ?? '' } })
  const m = useMutation({
    mutationFn: async (v: { full_name: string; nip: string; position: string; phone: string }) => {
      if (v.full_name.trim().length < 2) throw new Error('Nama wajib diisi.')
      if (v.nip && !/^[0-9 ]{8,25}$/.test(v.nip)) throw new Error('NIP hanya angka (8–25 digit).')
      const { error } = await supabase.from('profiles').update({ full_name: v.full_name.trim(), nip: v.nip || null, position: v.position || null, phone: v.phone || null }).eq('id', user!.id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Profil pengguna diperbarui.'); qc.invalidateQueries({ queryKey: ['profiles'] }); onOpenChange(false) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="flex min-h-0 flex-col">
          <DialogHeader><DialogTitle>Ubah profil pengguna</DialogTitle><DialogDescription>{user?.email}</DialogDescription></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nama lengkap" htmlFor="e-name" required className="sm:col-span-2"><Input id="e-name" {...form.register('full_name')} /></FormField>
            <FormField label="NIP" htmlFor="e-nip"><Input id="e-nip" {...form.register('nip')} /></FormField>
            <FormField label="Jabatan" htmlFor="e-pos"><Input id="e-pos" {...form.register('position')} /></FormField>
            <FormField label="Telepon" htmlFor="e-phone"><Input id="e-phone" {...form.register('phone')} /></FormField>
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

function ResetPasswordDialog({ user, onOpenChange }: { user: Profile | null; onOpenChange: (o: boolean) => void }) {
  const [pw, setPw] = useState(generatePassword())
  const m = useMutation({
    mutationFn: () => {
      const r = passwordSchema.safeParse(pw)
      if (!r.success) throw new Error(r.error.issues[0].message)
      return callAdmin({ action: 'reset_password', user_id: user!.id, password: pw })
    },
    onSuccess: () => { toast.success('Kata sandi baru disimpan. Sampaikan kepada pengguna secara langsung.'); onOpenChange(false) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open={!!user} onOpenChange={(o) => { if (o) setPw(generatePassword()); onOpenChange(o) }}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>Atur ulang kata sandi</DialogTitle><DialogDescription>{user?.email}</DialogDescription></DialogHeader>
        <DialogBody className="space-y-2">
          <div className="flex gap-2">
            <Input aria-label="Kata sandi baru" className="font-mono" value={pw} onChange={(e) => setPw(e.target.value)} />
            <Button variant="outline" onClick={() => setPw(generatePassword())}>Acak</Button>
          </div>
          <p className="text-xs text-muted-foreground">Minimal 10 karakter dengan huruf besar, huruf kecil, dan angka.</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={() => m.mutate()} loading={m.isPending}>Simpan kata sandi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const PERMISSION_LABELS: Record<string, string> = {
  dashboard: 'Dashboard', archive_read: 'Lihat arsip', archive_write: 'Input & ubah arsip', archive_delete: 'Hapus arsip',
  documents_upload: 'Unggah dokumen', documents_download: 'Unduh dokumen', import: 'Impor SiCANTIK', reports: 'Laporan',
  master_data: 'Kelola data induk', users: 'Kelola pengguna', audit: 'Audit trail', settings: 'Pengaturan', backup: 'Cadangan & pemulihan',
}

function RolesPanel({ roles }: { roles: Role[] }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Role | null>(null)
  const [desc, setDesc] = useState('')
  const [name, setName] = useState('')
  const save = async () => {
    const { error } = await supabase.from('roles').update({ name: name.trim(), description: desc.trim() || null }).eq('id', editing!.id)
    if (error) return void toast.error(errorMessage(error))
    toast.success('Peran diperbarui.')
    qc.invalidateQueries({ queryKey: ['roles'] })
    setEditing(null)
  }
  const keys = Object.keys(PERMISSION_LABELS)
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Matriks hak akses</CardTitle>
          <CardDescription>Hak akses ditegakkan oleh Row Level Security di database dan tidak dapat diubah dari aplikasi. Nama dan deskripsi peran dapat disesuaikan.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-semibold">Hak</th>
                {roles.map((r) => <th key={r.id} className="px-3 py-2 text-center font-semibold">{r.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k} className="border-b last:border-0">
                  <td className="py-2 pr-3">{PERMISSION_LABELS[k]}</td>
                  {roles.map((r) => (
                    <td key={r.id} className="px-3 py-2 text-center">
                      {r.permissions?.[k] ? <Check className="mx-auto size-4 text-success" aria-label="Ya" /> : <X className="mx-auto size-4 text-muted-foreground/50" aria-label="Tidak" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">Operator dapat mengubah data yang ia input sendiri. Dokumen “terbatas” hanya untuk Super Admin, Admin Arsip, Pimpinan, dan pengunggah; “rahasia” tanpa pengunggah Operator.</p>
        </CardContent>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        {roles.map((r) => (
          <Card key={r.id}>
            <CardHeader className="flex-row items-start justify-between">
              <div><CardTitle>{r.name}</CardTitle><CardDescription className="mt-1">{r.description}</CardDescription></div>
              <Button variant="ghost" size="icon-sm" aria-label="Ubah peran" onClick={() => { setEditing(r); setName(r.name); setDesc(r.description ?? '') }}><Pencil /></Button>
            </CardHeader>
          </Card>
        ))}
      </div>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>Ubah peran</DialogTitle><DialogDescription>Kode sistem: {editing?.code}</DialogDescription></DialogHeader>
          <DialogBody className="space-y-3">
            <FormField label="Nama peran" htmlFor="r-name"><Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
            <FormField label="Deskripsi" htmlFor="r-desc"><Textarea id="r-desc" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></FormField>
          </DialogBody>
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Batal</Button><Button onClick={save}>Simpan</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function UsersPage() {
  const { profile: me } = useAuth()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [resetting, setResetting] = useState<Profile | null>(null)
  const [deleting, setDeleting] = useState<Profile | null>(null)

  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('roles').select('*').order('created_at')
      if (error) throw error
      const order = ['super_admin', 'admin_arsip', 'operator', 'pimpinan']
      return (data as Role[]).sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code))
    },
  })
  const users = useQuery({
    queryKey: ['profiles', 'list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*, role:roles(*)').order('created_at')
      if (error) throw error
      return data as Profile[]
    },
  })

  const update = async (u: Profile, patch: Partial<Profile>) => {
    const { error } = await supabase.from('profiles').update(patch).eq('id', u.id)
    if (error) return void toast.error(errorMessage(error))
    toast.success('Pengguna diperbarui.')
    qc.invalidateQueries({ queryKey: ['profiles'] })
  }

  const rows = users.data?.filter((u) => `${u.full_name} ${u.email} ${u.nip ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  const pending = users.data?.filter((u) => !u.is_active).length ?? 0

  const columns: Column<Profile>[] = [
    { key: 'name', header: 'Pengguna', cell: (u) => <div className="min-w-52"><p className="font-medium">{u.full_name || '—'} {u.id === me?.id && <Badge variant="muted">Anda</Badge>}</p><p className="text-xs text-muted-foreground">{u.email}</p></div> },
    { key: 'nip', header: 'NIP / jabatan', cell: (u) => <div className="text-sm"><p className="tabular">{u.nip ?? '—'}</p><p className="text-xs text-muted-foreground">{u.position ?? ''}</p></div> },
    {
      key: 'role', header: 'Peran',
      cell: (u) => (
        <NativeSelect aria-label={`Peran ${u.email}`} className="h-8 w-40" value={u.role_id} disabled={u.id === me?.id}
          onChange={(e) => update(u, { role_id: e.target.value })}>
          {roles.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </NativeSelect>
      ),
    },
    {
      key: 'active', header: 'Aktif',
      cell: (u) => <Switch aria-label={`Aktifkan ${u.email}`} checked={u.is_active} disabled={u.id === me?.id} onCheckedChange={(v) => update(u, { is_active: v })} />,
    },
    { key: 'last_login', header: 'Terakhir masuk', cell: (u) => <span className="whitespace-nowrap text-sm" title={formatDateTime(u.last_login_at)}>{u.last_login_at ? formatRelative(u.last_login_at) : 'Belum pernah'}</span> },
    {
      key: 'actions', header: <span className="sr-only">Aksi</span>, className: 'w-10 text-right',
      cell: (u) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Aksi"><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditing(u)}><Pencil /> Ubah profil</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setResetting(u)}><KeyRound /> Atur ulang kata sandi</DropdownMenuItem>
            {u.id !== me?.id && <DropdownMenuItem className="text-destructive" onSelect={() => setDeleting(u)}><Trash2 /> Hapus akun</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div>
      <PageHeader title="Pengguna & peran" description="Kelola akun petugas DPMPTSP dan hak aksesnya." actions={<Button onClick={() => setCreating(true)}><Plus /> Tambah pengguna</Button>} />
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Pengguna {pending > 0 && <Badge variant="warning">{pending} nonaktif</Badge>}</TabsTrigger>
          <TabsTrigger value="roles">Peran & hak akses</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <Card>
            <div className="border-b p-3"><SearchInput value={search} onChange={setSearch} placeholder="Cari nama, email, NIP" /></div>
            <DataTable columns={columns} rows={rows} rowKey={(u) => u.id} loading={users.isLoading} error={users.error} onRetry={() => users.refetch()}
              empty={<EmptyState title="Tidak ada pengguna" />} />
          </Card>
        </TabsContent>
        <TabsContent value="roles">{roles.data && <RolesPanel roles={roles.data} />}</TabsContent>
      </Tabs>
      {roles.data && <CreateUserDialog open={creating} onOpenChange={setCreating} roles={roles.data} />}
      <EditUserDialog user={editing} onOpenChange={(o) => !o && setEditing(null)} />
      <ResetPasswordDialog user={resetting} onOpenChange={(o) => !o && setResetting(null)} />
      <ConfirmDialog
        open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}
        title="Hapus akun?"
        description={<>Akun <strong>{deleting?.email}</strong> dihapus permanen dan tidak dapat masuk lagi. Riwayat aktivitasnya tetap tersimpan di audit trail. Untuk menonaktifkan sementara, gunakan sakelar Aktif.</>}
        confirmLabel="Hapus akun" destructive
        onConfirm={async () => {
          try {
            await callAdmin({ action: 'delete', user_id: deleting!.id })
            toast.success('Akun dihapus.')
            qc.invalidateQueries({ queryKey: ['profiles'] })
          } catch (e) { toast.error(errorMessage(e)); throw e }
        }}
      />
    </div>
  )
}
