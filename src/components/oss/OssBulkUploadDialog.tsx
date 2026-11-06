import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, FileText, Loader2, SkipForward, Trash2, UploadCloud, XCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { inspectPdf, type FileCheck } from '@/lib/documents'
import { extractPdfText, findNib, latestNibDocuments, uploadOssDocument } from '@/lib/ossDocuments'
import { errorMessage } from '@/lib/errors'
import { formatBytes, formatNumber } from '@/lib/format'
import { logActivity } from '@/lib/activity'
import { ACCESS_LEVELS, OSS_DOC_CATEGORIES, categoryLabel } from '@/lib/constants'
import { useSettings } from '@/hooks/useSettings'
import { useAuth } from '@/hooks/useAuth'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/misc'
import { cn } from '@/lib/utils'
import type { AccessLevel, OssDocument } from '@/types'

const MAX_FILES = 200

type Status = 'checking' | 'ready' | 'unmatched' | 'invalid' | 'uploading' | 'done' | 'skipped' | 'error'
interface Item {
  key: string
  file: File
  check?: FileCheck
  nib: string
  source: 'nama file' | 'isi PDF' | 'manual' | null
  status: Status
  message?: string
}

interface DirEntry { nib: string; name: string; has_nib_document: boolean }

export function OssBulkUploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const { can, profile } = useAuth()
  const { data: settings } = useSettings()
  const maxMb = settings?.maxFileSizeMb ?? 25
  const [items, setItems] = useState<Item[]>([])
  const [category, setCategory] = useState('nib')
  const [access, setAccess] = useState<AccessLevel>('biasa')
  const [existingMode, setExistingMode] = useState<'skip' | 'version'>('skip')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const dir = useQuery({
    queryKey: ['oss', 'nib-directory'],
    enabled: open,
    queryFn: async () => {
      const all: DirEntry[] = []
      for (let i = 0; i < 50; i++) {
        const { data, error } = await supabase.rpc('oss_nib_directory').range(i * 1000, i * 1000 + 999)
        if (error) throw error
        all.push(...(data as DirEntry[]))
        if (data.length < 1000) break
      }
      return new Map(all.map((d) => [d.nib, d]))
    },
  })
  const known = useMemo(() => new Set(dir.data?.keys() ?? []), [dir.data])
  const update = (key: string, patch: Partial<Item>) => setItems((p) => p.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  const add = async (files: FileList | File[]) => {
    const pdfs = Array.from(files).filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf')
    const room = MAX_FILES - items.length
    if (pdfs.length > room) toast.warning(`Maksimal ${MAX_FILES} file per unggahan; ${pdfs.length - room} file tidak ditambahkan.`)
    const next: Item[] = pdfs.slice(0, Math.max(room, 0)).map((file) => ({ key: crypto.randomUUID(), file, nib: '', source: null, status: 'checking' }))
    setItems((p) => [...p, ...next])
    for (const it of next) {
      const check = await inspectPdf(it.file, maxMb)
      if (!check.ok) { update(it.key, { check, status: 'invalid', message: check.message }); continue }
      let m = findNib(it.file.name, '', known)
      if (!m.nib) m = findNib('', await extractPdfText(it.file), known)
      update(it.key, m.nib ? { check, nib: m.nib, source: m.source, status: 'ready' } : { check, status: 'unmatched', message: 'NIB tidak dikenali — isi manual' })
    }
  }

  const setNib = (it: Item, value: string) => {
    const nib = value.replace(/\D/g, '').slice(0, 13)
    const ok = known.has(nib)
    update(it.key, { nib, source: ok ? 'manual' : null, status: ok ? 'ready' : 'unmatched', message: ok ? undefined : nib.length === 13 ? 'NIB tidak ada di data OSS' : 'NIB tidak dikenali — isi manual' })
  }

  // NIB yang muncul lebih dari sekali di daftar
  const dupes = useMemo(() => {
    const seen = new Map<string, number>()
    items.forEach((i) => i.nib && i.status !== 'invalid' && seen.set(i.nib, (seen.get(i.nib) ?? 0) + 1))
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k))
  }, [items])

  const counts = useMemo(() => ({
    ready: items.filter((i) => i.status === 'ready').length,
    unmatched: items.filter((i) => i.status === 'unmatched').length,
    invalid: items.filter((i) => i.status === 'invalid').length,
    checking: items.filter((i) => i.status === 'checking').length,
    existing: items.filter((i) => i.status === 'ready' && category === 'nib' && dir.data?.get(i.nib)?.has_nib_document).length,
  }), [items, category, dir.data])

  const run = async () => {
    const queue = items.filter((i) => i.status === 'ready' && (category !== 'nib' || !dupes.has(i.nib)))
    if (!queue.length) return
    setRunning(true)
    setProgress({ done: 0, total: queue.length })
    let existing = new Map<string, OssDocument>()
    try {
      if (category === 'nib') existing = await latestNibDocuments([...new Set(queue.map((q) => q.nib))])
    } catch (e) {
      toast.error(errorMessage(e)); setRunning(false); return
    }
    let ok = 0, skipped = 0, failed = 0
    for (const [n, it] of queue.entries()) {
      const prev = existing.get(it.nib)
      if (prev && existingMode === 'skip') {
        update(it.key, { status: 'skipped', message: `Sudah ada file NIB (v${prev.version})` }); skipped++
      } else {
        update(it.key, { status: 'uploading' })
        const name = dir.data?.get(it.nib)?.name ?? it.nib
        try {
          const doc = await uploadOssDocument({
            file: it.file, nib: it.nib, category, accessLevel: access,
            title: prev?.title ?? `${category === 'nib' ? 'NIB' : categoryLabel(category)} ${name}`,
            documentNumber: category === 'nib' ? it.nib : undefined,
            documentGroupId: prev?.document_group_id, changeNote: prev ? 'Diperbarui melalui unggah massal' : undefined,
          }, it.check!)
          update(it.key, { status: 'done', message: prev ? `Versi baru v${doc.version}` : undefined }); ok++
          existing.set(it.nib, doc)
        } catch (e) {
          update(it.key, { status: 'error', message: errorMessage(e) }); failed++
        }
      }
      setProgress({ done: n + 1, total: queue.length })
    }
    setRunning(false)
    qc.invalidateQueries({ queryKey: ['oss'] })
    void logActivity('document.upload', 'oss_documents', null,
      `Unggah massal dokumen OSS (${categoryLabel(category)}): ${ok} tersimpan, ${skipped} dilewati, ${failed} gagal — oleh ${profile?.email}`,
      { category, uploaded: ok, skipped, failed })
    toast[failed ? 'warning' : 'success'](`${ok} file tersimpan${skipped ? `, ${skipped} dilewati` : ''}${failed ? `, ${failed} gagal` : ''}.`)
  }

  const reset = () => { setItems([]); setProgress(null) }
  const finished = progress && progress.done === progress.total && !running

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!running) { if (!o) reset(); onOpenChange(o) } }}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Unggah massal dokumen OSS</DialogTitle>
          <DialogDescription>
            Pilih banyak PDF sekaligus (maks. {MAX_FILES}). Setiap file dicocokkan ke pelaku usaha melalui NIB 13 digit di nama file, atau
            bila tidak ada, dari teks di halaman pertama PDF. {dir.data && <>Tersedia {formatNumber(dir.data.size)} NIB dari data OSS.</>}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="bulk-cat">Jenis dokumen</label>
              <NativeSelect id="bulk-cat" value={category} disabled={running} onChange={(e) => setCategory(e.target.value)}>
                {OSS_DOC_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </NativeSelect>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="bulk-access">Tingkat akses</label>
              <NativeSelect id="bulk-access" value={access} disabled={running} onChange={(e) => setAccess(e.target.value as AccessLevel)}>
                {ACCESS_LEVELS.filter((a) => a.value !== 'rahasia' || can('documents.secret')).map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </NativeSelect>
            </div>
            {category === 'nib' && (
              <div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="bulk-exist">Bila file NIB sudah ada</label>
                <NativeSelect id="bulk-exist" value={existingMode} disabled={running} onChange={(e) => setExistingMode(e.target.value as 'skip' | 'version')}>
                  <option value="skip">Lewati (jangan unggah)</option>
                  <option value="version">Simpan sebagai versi baru</option>
                </NativeSelect>
              </div>
            )}
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (!running && dir.data) void add(e.dataTransfer.files) }}
            className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-input bg-muted/40 px-6 py-6 text-center"
          >
            <UploadCloud className="size-8 text-primary" />
            <p className="text-sm font-medium">Tarik file PDF ke sini, atau</p>
            <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()} disabled={running || !dir.data} loading={dir.isLoading}>Pilih file PDF</Button>
            <p className="text-xs text-muted-foreground">Contoh nama file yang dikenali: <span className="tabular">0220001234567.pdf</span>, <span className="tabular">NIB_0220001234567_CV Maju.pdf</span></p>
            <input ref={input} type="file" accept="application/pdf,.pdf" multiple className="hidden"
              onChange={(e) => { if (e.target.files) void add(e.target.files); e.target.value = '' }} />
          </div>

          {items.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="success">{counts.ready} siap</Badge>
                {counts.unmatched > 0 && <Badge variant="warning">{counts.unmatched} belum cocok</Badge>}
                {counts.invalid > 0 && <Badge variant="danger">{counts.invalid} file tidak valid</Badge>}
                {counts.checking > 0 && <Badge variant="muted"><Loader2 className="mr-1 size-3 animate-spin" />{counts.checking} diperiksa</Badge>}
                {counts.existing > 0 && <span className="text-xs text-muted-foreground">{counts.existing} pelaku usaha sudah memiliki file NIB → {existingMode === 'skip' ? 'dilewati' : 'versi baru'}</span>}
                {!running && <Button size="sm" variant="ghost" className="ml-auto" onClick={reset}>Kosongkan daftar</Button>}
              </div>
              {progress && <div className="space-y-1"><Progress value={(progress.done / progress.total) * 100} /><p className="text-xs text-muted-foreground tabular">{progress.done} / {progress.total} diproses</p></div>}
              <datalist id="oss-nib-list">
                {[...(dir.data?.values() ?? [])].slice(0, 3000).map((d) => <option key={d.nib} value={d.nib}>{d.name}</option>)}
              </datalist>
              <ul className="max-h-[46vh] divide-y overflow-y-auto rounded-lg border" aria-label="Daftar file">
                {items.map((it) => {
                  const entry = dir.data?.get(it.nib)
                  const dup = category === 'nib' && dupes.has(it.nib) && it.status === 'ready'
                  return (
                    <li key={it.key} className={cn('flex flex-wrap items-center gap-3 px-3 py-2', it.status === 'done' && 'bg-[#f3fbf7]')}>
                      <FileText className="size-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1 basis-56">
                        <p className="truncate text-sm font-medium">{it.file.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {formatBytes(it.file.size)}{it.check?.pageCount ? ` · ${it.check.pageCount} hlm` : ''}
                          {entry && <> · <span className="text-foreground">{entry.name}</span></>}
                          {it.source && it.source !== 'manual' && ` · cocok dari ${it.source}`}
                        </p>
                      </div>
                      {['ready', 'unmatched'].includes(it.status) && !running ? (
                        <Input aria-label={`NIB untuk ${it.file.name}`} list="oss-nib-list" inputMode="numeric" className={cn('h-8 w-44 tabular', it.status === 'unmatched' && 'border-warning')}
                          placeholder="NIB 13 digit" value={it.nib} onChange={(e) => setNib(it, e.target.value)} />
                      ) : <span className="w-44 text-sm tabular">{it.nib || '—'}</span>}
                      <span className="w-48 text-xs">
                        {it.status === 'checking' && <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Memeriksa</span>}
                        {it.status === 'ready' && (dup ? <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle className="size-3.5" /> NIB ganda di daftar (dilewati)</span>
                          : entry?.has_nib_document && category === 'nib' ? <span className="text-muted-foreground">Sudah ada file NIB</span> : <span className="text-success">Siap</span>)}
                        {it.status === 'unmatched' && <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle className="size-3.5" /> {it.message}</span>}
                        {(it.status === 'invalid' || it.status === 'error') && <span className="inline-flex items-center gap-1 text-destructive"><XCircle className="size-3.5" /> {it.message}</span>}
                        {it.status === 'uploading' && <span className="inline-flex items-center gap-1 text-primary"><Loader2 className="size-3 animate-spin" /> Mengunggah</span>}
                        {it.status === 'done' && <span className="inline-flex items-center gap-1 font-medium text-success"><CheckCircle2 className="size-3.5" /> Tersimpan{it.message ? ` · ${it.message}` : ''}</span>}
                        {it.status === 'skipped' && <span className="inline-flex items-center gap-1 text-muted-foreground"><SkipForward className="size-3.5" /> {it.message}</span>}
                      </span>
                      {!running && !['done', 'uploading'].includes(it.status) && (
                        <Button variant="ghost" size="icon-sm" aria-label={`Hapus ${it.file.name} dari daftar`} onClick={() => setItems((p) => p.filter((x) => x.key !== it.key))}><Trash2 /></Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={running} onClick={() => { reset(); onOpenChange(false) }}>{finished ? 'Selesai' : 'Tutup'}</Button>
          <Button loading={running} disabled={!counts.ready || counts.checking > 0} onClick={run}>
            Unggah {counts.ready} file
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
