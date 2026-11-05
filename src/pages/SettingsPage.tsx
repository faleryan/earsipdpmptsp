import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { DatabaseBackup, Download, Plus, Trash2, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { downloadBlob } from '@/lib/utils'
import { formatBytes, formatDateTime, formatNumber } from '@/lib/format'
import { ROLE_LABELS, ENTITY_LABELS } from '@/lib/constants'
import { listClassifications } from '@/lib/api'
import { useSettings, type AppIdentity } from '@/hooks/useSettings'
import { PageHeader } from '@/components/common/PageHeader'
import { FormField } from '@/components/common/FormField'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { FullPageLoader } from '@/components/common/States'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input, NativeSelect } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { RoleCode } from '@/types'

async function saveSetting(key: string, value: unknown) {
  const { error } = await supabase.from('system_settings').update({ value }).eq('key', key)
  if (error) throw error
}

function IdentityCard({ initial }: { initial: AppIdentity }) {
  const qc = useQueryClient()
  const [v, setV] = useState(initial)
  const [busy, setBusy] = useState(false)
  useEffect(() => setV(initial), [initial])
  const f = (k: keyof AppIdentity) => ({ value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value }) })
  return (
    <Card>
      <CardHeader><CardTitle>Identitas instansi</CardTitle><CardDescription>Dipakai pada kop laporan Excel dan PDF.</CardDescription></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <FormField label="Nama aplikasi" htmlFor="s-app"><Input id="s-app" {...f('app_name')} /></FormField>
        <FormField label="Nama singkat instansi" htmlFor="s-short"><Input id="s-short" {...f('agency_short')} /></FormField>
        <FormField label="Nama lengkap instansi" htmlFor="s-agency" className="sm:col-span-2"><Input id="s-agency" {...f('agency_name')} /></FormField>
        <FormField label="Alamat" htmlFor="s-addr" className="sm:col-span-2"><Input id="s-addr" {...f('address')} /></FormField>
        <FormField label="Telepon" htmlFor="s-phone"><Input id="s-phone" {...f('phone')} /></FormField>
        <FormField label="Email" htmlFor="s-email"><Input id="s-email" type="email" {...f('email')} /></FormField>
        <div className="sm:col-span-2">
          <Button loading={busy} onClick={async () => {
            if (v.agency_name.trim().length < 5) return void toast.error('Nama instansi wajib diisi.')
            setBusy(true)
            try { await saveSetting('app.identity', v); toast.success('Identitas instansi disimpan.'); qc.invalidateQueries({ queryKey: ['system_settings'] }) }
            catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
          }}>Simpan identitas</Button>
        </div>
      </CardContent>
    </Card>
  )
}

function DocumentsCard({ maxMb, ttl, roles, idle, chunkSize }: { maxMb: number; ttl: number; roles: string[]; idle: number; chunkSize: number }) {
  const qc = useQueryClient()
  const [m, setM] = useState(String(maxMb))
  const [t, setT] = useState(String(ttl))
  const [r, setR] = useState<string[]>(roles)
  const [i, setI] = useState(String(idle))
  const [c, setC] = useState(String(chunkSize))
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const mm = Number(m), tt = Number(t), ii = Number(i), cc = Number(c)
    if (!(mm >= 1 && mm <= 25)) return void toast.error('Ukuran file 1–25 MB (batas bucket storage 25 MB).')
    if (!(tt >= 30 && tt <= 3600)) return void toast.error('Masa berlaku tautan 30–3600 detik.')
    if (!(ii >= 0 && ii <= 480)) return void toast.error('Batas tidak aktif 0–480 menit (0 = nonaktif).')
    if (!(cc >= 50 && cc <= 1000)) return void toast.error('Ukuran potongan impor 50–1000 baris.')
    setBusy(true)
    try {
      await Promise.all([
        saveSetting('documents.max_file_size_mb', mm), saveSetting('documents.signed_url_ttl_seconds', tt),
        saveSetting('documents.download_roles', r), saveSetting('security.idle_timeout_minutes', ii), saveSetting('import.chunk_size', cc),
      ])
      toast.success('Pengaturan disimpan.')
      qc.invalidateQueries({ queryKey: ['system_settings'] })
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <Card>
      <CardHeader><CardTitle>Dokumen, keamanan, dan impor</CardTitle></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <FormField label="Ukuran maksimum PDF (MB)" htmlFor="s-max"><Input id="s-max" type="number" min={1} max={25} value={m} onChange={(e) => setM(e.target.value)} /></FormField>
        <FormField label="Masa berlaku tautan file (detik)" htmlFor="s-ttl" hint="Tautan signed URL kedaluwarsa setelah waktu ini."><Input id="s-ttl" type="number" value={t} onChange={(e) => setT(e.target.value)} /></FormField>
        <FormField label="Keluar otomatis setelah tidak aktif (menit)" htmlFor="s-idle" hint="0 untuk menonaktifkan."><Input id="s-idle" type="number" value={i} onChange={(e) => setI(e.target.value)} /></FormField>
        <FormField label="Baris per transaksi impor" htmlFor="s-chunk"><Input id="s-chunk" type="number" value={c} onChange={(e) => setC(e.target.value)} /></FormField>
        <div className="sm:col-span-2">
          <p className="mb-2 text-sm font-medium">Peran yang boleh mengunduh PDF</p>
          <div className="flex flex-wrap gap-4">
            {(Object.keys(ROLE_LABELS) as RoleCode[]).map((code) => (
              <label key={code} className="flex items-center gap-2 text-sm">
                <Checkbox checked={r.includes(code)} disabled={code === 'super_admin'} onCheckedChange={(v) => setR(v ? [...r, code] : r.filter((x) => x !== code))} />
                {ROLE_LABELS[code]}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">Peran lain tetap dapat melihat pratinjau sesuai tingkat akses dokumen.</p>
        </div>
        <div className="sm:col-span-2"><Button onClick={save} loading={busy}>Simpan pengaturan</Button></div>
      </CardContent>
    </Card>
  )
}

interface Rule { pattern: string; sector: string }

function SectorRulesCard({ rules, mapping }: { rules: Rule[]; mapping: Record<string, string> }) {
  const qc = useQueryClient()
  const classes = useQuery({ queryKey: ['classifications'], queryFn: listClassifications })
  const [list, setList] = useState<Rule[]>(rules)
  const [map, setMap] = useState<Record<string, string>>(mapping)
  const [busy, setBusy] = useState(false)
  const sectors = Array.from(new Set([...list.map((r) => r.sector), ...Object.keys(map), 'Lainnya'])).filter(Boolean)
  const save = async () => {
    for (const r of list) {
      if (!r.pattern.trim() || !r.sector.trim()) return void toast.error('Pola dan sektor tidak boleh kosong.')
      try { new RegExp(r.pattern, 'i') } catch { return void toast.error(`Pola tidak valid: ${r.pattern}`) }
    }
    setBusy(true)
    try {
      await saveSetting('import.sector_rules', list.map((r) => ({ pattern: r.pattern.trim(), sector: r.sector.trim() })))
      await saveSetting('import.sector_classification', Object.fromEntries(sectors.map((s) => [s, map[s] ?? ''])))
      toast.success('Aturan sektor disimpan. Berlaku untuk jenis izin baru pada impor berikutnya.')
      qc.invalidateQueries({ queryKey: ['system_settings'] })
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Aturan sektor jenis izin baru</CardTitle>
        <CardDescription>Saat impor menemukan jenis izin baru, sektornya ditentukan dari pola pertama yang cocok dengan nama izin (regex, tanpa membedakan huruf besar). Klasifikasi default mengikuti sektor.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {list.map((r, idx) => (
            <div key={idx} className="grid gap-2 sm:grid-cols-[1fr_12rem_auto]">
              <Input aria-label="Pola" value={r.pattern} onChange={(e) => setList(list.map((x, j) => (j === idx ? { ...x, pattern: e.target.value } : x)))} className="font-mono text-xs" />
              <Input aria-label="Sektor" value={r.sector} onChange={(e) => setList(list.map((x, j) => (j === idx ? { ...x, sector: e.target.value } : x)))} />
              <Button variant="ghost" size="icon" aria-label="Hapus aturan" onClick={() => setList(list.filter((_, j) => j !== idx))}><Trash2 /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setList([...list, { pattern: '', sector: '' }])}><Plus /> Tambah aturan</Button>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Klasifikasi default per sektor</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {sectors.map((s) => (
              <label key={s} className="grid grid-cols-[8rem_1fr] items-center gap-2 text-sm">
                <span>{s}</span>
                <NativeSelect value={map[s] ?? ''} onChange={(e) => setMap({ ...map, [s]: e.target.value })}>
                  <option value="">— Tanpa klasifikasi —</option>
                  {classes.data?.map((c) => <option key={c.id} value={c.code}>{c.code} — {c.name}</option>)}
                </NativeSelect>
              </label>
            ))}
          </div>
        </div>
        <Button onClick={save} loading={busy}>Simpan aturan</Button>
      </CardContent>
    </Card>
  )
}

interface BackupFile { app: string; format_version: number; generated_at: string; counts: Record<string, number>; tables: Record<string, unknown[]> }

function BackupCard() {
  const [exporting, setExporting] = useState(false)
  const [file, setFile] = useState<{ name: string; size: number; data: BackupFile } | null>(null)
  const [dry, setDry] = useState<Record<string, { rows: number; restored: number }> | null>(null)
  const [checking, setChecking] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const lastBackup = useQuery({
    queryKey: ['activity_logs', 'backup'],
    queryFn: async () => {
      const { data } = await supabase.from('activity_logs').select('created_at, user_email').eq('action', 'backup.export').order('created_at', { ascending: false }).limit(1)
      return data?.[0] ?? null
    },
  })

  const doExport = async () => {
    setExporting(true)
    try {
      const { data, error } = await supabase.rpc('export_backup')
      if (error) throw error
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
      downloadBlob(blob, `cadangan-e-arsip-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`)
      toast.success(`Cadangan dibuat (${formatBytes(blob.size)}). Simpan file ini di tempat aman.`)
      lastBackup.refetch()
    } catch (e) { toast.error(errorMessage(e)) } finally { setExporting(false) }
  }

  const onFile = async (f: File) => {
    setDry(null)
    try {
      const data = JSON.parse(await f.text()) as BackupFile
      if (data.app !== 'e-arsip-perizinan-belu' || data.format_version !== 1) throw new Error('File bukan cadangan E-Arsip yang dikenali.')
      setFile({ name: f.name, size: f.size, data })
      setChecking(true)
      const { data: res, error } = await supabase.rpc('restore_backup', { p_data: data, p_dry_run: true })
      if (error) throw error
      setDry((res as { tables: Record<string, { rows: number; restored: number }> }).tables)
    } catch (e) {
      setFile(null)
      toast.error(errorMessage(e))
    } finally { setChecking(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><DatabaseBackup className="size-5 text-primary" /> Cadangan & pemulihan data</CardTitle>
        <CardDescription>
          Cadangan berisi seluruh data tabel (arsip, metadata dokumen, pengguna, audit). File PDF di Storage dicadangkan terpisah dengan skrip <code>npm run backup:storage</code> — lihat dokumentasi.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={doExport} loading={exporting}><Download /> Unduh cadangan data (JSON)</Button>
          <p className="text-sm text-muted-foreground">
            {lastBackup.data ? `Cadangan terakhir ${formatDateTime(lastBackup.data.created_at)} oleh ${lastBackup.data.user_email}` : 'Belum pernah membuat cadangan dari aplikasi.'}
          </p>
        </div>
        <div className="rounded-lg border border-dashed p-4">
          <p className="text-sm font-semibold">Pulihkan dari file cadangan</p>
          <p className="mt-1 text-sm text-muted-foreground">Data dengan ID yang sama diperbarui ke isi cadangan, data yang tidak ada ditambahkan. Data yang dibuat setelah cadangan tidak dihapus. Seluruh proses berjalan dalam satu transaksi.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => input.current?.click()} loading={checking}><Upload /> Pilih file cadangan</Button>
            <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
            {file && <span className="text-sm">{file.name} · {formatBytes(file.size)} · dibuat {formatDateTime(file.data.generated_at)}</span>}
          </div>
          {dry && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {Object.entries(dry).filter(([, v]) => v.rows > 0).map(([t, v]) => (
                  <div key={t} className="rounded-md border px-3 py-2">
                    <p className="text-xs text-muted-foreground">{ENTITY_LABELS[t] ?? t}</p>
                    <p className="font-semibold tabular">{formatNumber(v.restored)}{v.restored !== v.rows && <span className="text-xs font-normal text-muted-foreground"> / {formatNumber(v.rows)}</span>}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Uji pemulihan berhasil tanpa mengubah data. Profil pengguna yang akunnya tidak ada di proyek ini dilewati.</p>
              <Button variant="destructive" onClick={() => setConfirm(true)}>Pulihkan data sekarang</Button>
            </div>
          )}
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirm} onOpenChange={setConfirm}
        title="Pulihkan data dari cadangan?"
        description={<>Data saat ini dengan ID yang sama akan diganti dengan isi cadangan tanggal <strong>{file && formatDateTime(file.data.generated_at)}</strong>. Buat cadangan terbaru terlebih dahulu bila ragu. Tindakan tercatat di audit trail.</>}
        confirmLabel="Ya, pulihkan" destructive
        onConfirm={async () => {
          const { error } = await supabase.rpc('restore_backup', { p_data: file!.data, p_dry_run: false })
          if (error) { toast.error(errorMessage(error)); throw error }
          toast.success('Data berhasil dipulihkan.')
          setFile(null); setDry(null)
          qc.invalidateQueries()
        }}
      />
    </Card>
  )
}

export default function SettingsPage() {
  const { data, isLoading } = useSettings()
  if (isLoading || !data) return <FullPageLoader />
  const raw = data.raw
  return (
    <div>
      <PageHeader title="Pengaturan & cadangan" description="Konfigurasi sistem. Hanya Super Admin yang dapat mengubah halaman ini; setiap perubahan tercatat di audit trail." />
      <Tabs defaultValue="umum">
        <TabsList>
          <TabsTrigger value="umum">Umum</TabsTrigger>
          <TabsTrigger value="impor">Aturan impor</TabsTrigger>
          <TabsTrigger value="cadangan">Cadangan & pemulihan</TabsTrigger>
        </TabsList>
        <TabsContent value="umum" className="space-y-4">
          <IdentityCard initial={data.identity} />
          <DocumentsCard maxMb={data.maxFileSizeMb} ttl={data.signedUrlTtl} roles={data.downloadRoles} idle={data.idleTimeoutMinutes} chunkSize={data.importChunkSize} />
        </TabsContent>
        <TabsContent value="impor">
          <SectorRulesCard
            rules={(raw['import.sector_rules']?.value as Rule[]) ?? []}
            mapping={(raw['import.sector_classification']?.value as Record<string, string>) ?? {}}
          />
        </TabsContent>
        <TabsContent value="cadangan"><BackupCard /></TabsContent>
      </Tabs>
    </div>
  )
}
