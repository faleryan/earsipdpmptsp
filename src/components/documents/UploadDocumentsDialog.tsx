import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, FileText, Loader2, Trash2, UploadCloud, XCircle } from 'lucide-react'
import { inspectPdf, uploadDocument, findDuplicateChecksum, type FileCheck } from '@/lib/documents'
import { errorMessage } from '@/lib/errors'
import { formatBytes } from '@/lib/format'
import { ACCESS_LEVELS, DOCUMENT_CATEGORIES, categoryLabel } from '@/lib/constants'
import { useSettings } from '@/hooks/useSettings'
import { useAuth } from '@/hooks/useAuth'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Progress } from '@/components/ui/misc'
import { cn } from '@/lib/utils'
import type { AccessLevel, ArchiveDocument, DocumentCategory } from '@/types'

interface Item {
  key: string
  file: File
  category: DocumentCategory
  title: string
  documentNumber: string
  documentDate: string
  check?: FileCheck
  checking: boolean
  status: 'pending' | 'uploading' | 'done' | 'error'
  error?: string
  duplicateOf?: string
}

function guessCategory(name: string): DocumentCategory {
  const n = name.toLowerCase()
  if (/ktp|identitas|kk\b|kartu/.test(n)) return 'identitas_pemohon'
  if (/rekom/.test(n)) return 'rekomendasi_teknis'
  if (/berita|\bba\b|bap/.test(n)) return 'berita_acara'
  if (/\bsk\b|keputusan|izin|sip|kkpr/.test(n)) return 'surat_keputusan'
  if (/permohonan|surat.?mohon/.test(n)) return 'surat_permohonan'
  if (/syarat|str|ijazah|npwp|nib/.test(n)) return 'dokumen_persyaratan'
  return 'dokumen_pendukung'
}

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  applicationId: string
  applicationNumber: string
  permitId?: string | null
  defaultAccess?: AccessLevel
  defaultCategory?: DocumentCategory
  /** Mode versi baru */
  versionOf?: ArchiveDocument | null
}

export function UploadDocumentsDialog({ open, onOpenChange, applicationId, applicationNumber, permitId, defaultAccess = 'biasa', defaultCategory, versionOf }: Props) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const { data: settings } = useSettings()
  const maxMb = settings?.maxFileSizeMb ?? 25
  const [items, setItems] = useState<Item[]>([])
  const [access, setAccess] = useState<AccessLevel>(versionOf?.access_level ?? defaultAccess)
  const [description, setDescription] = useState('')
  const [changeNote, setChangeNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = () => { setItems([]); setDescription(''); setChangeNote(''); setAccess(versionOf?.access_level ?? defaultAccess) }

  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files)
    const allowed = versionOf ? list.slice(0, 1) : list.slice(0, 20)
    if (list.length > allowed.length) toast.info(versionOf ? 'Versi baru hanya menerima satu file.' : 'Maksimal 20 file per unggahan.')
    const next: Item[] = allowed.map((file) => ({
      key: crypto.randomUUID(),
      file,
      category: versionOf?.category ?? defaultCategory ?? guessCategory(file.name),
      title: versionOf?.title ?? file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim(),
      documentNumber: versionOf?.document_number ?? '',
      documentDate: '',
      checking: true,
      status: 'pending',
    }))
    setItems((prev) => (versionOf ? next : [...prev, ...next]))
    next.forEach(async (it) => {
      const check = await inspectPdf(it.file, maxMb)
      const dup = check.ok && check.checksum ? await findDuplicateChecksum(applicationId, check.checksum) : null
      setItems((prev) => prev.map((p) => p.key === it.key ? { ...p, check, checking: false, duplicateOf: dup ? `${dup.title} (v${dup.version})` : undefined } : p))
    })
  }, [applicationId, defaultCategory, maxMb, versionOf])

  const update = (key: string, patch: Partial<Item>) => setItems((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)))

  const ready = items.filter((i) => i.status !== 'done' && i.check?.ok)
  const done = items.filter((i) => i.status === 'done').length

  const submit = async () => {
    if (versionOf && !changeNote.trim()) return void toast.error('Tuliskan alasan perubahan untuk versi baru.')
    if (ready.some((i) => i.title.trim().length < 2)) return void toast.error('Judul dokumen minimal 2 karakter.')
    setBusy(true)
    let ok = 0
    for (const it of ready) {
      update(it.key, { status: 'uploading', error: undefined })
      try {
        await uploadDocument({
          file: it.file, applicationId, permitId: it.category === 'surat_keputusan' ? permitId : null,
          category: it.category, title: it.title.trim(), description, documentNumber: it.documentNumber,
          documentDate: it.documentDate, accessLevel: access, documentGroupId: versionOf?.document_group_id,
          changeNote: versionOf ? changeNote : undefined,
        }, it.check!)
        update(it.key, { status: 'done' })
        ok++
      } catch (e) {
        update(it.key, { status: 'error', error: errorMessage(e) })
      }
    }
    setBusy(false)
    qc.invalidateQueries({ queryKey: ['documents'] })
    qc.invalidateQueries({ queryKey: ['application'] })
    qc.invalidateQueries({ queryKey: ['archive'] })
    if (ok) toast.success(versionOf ? 'Versi baru tersimpan.' : `${ok} dokumen berhasil diunggah.`)
    if (ok === ready.length) { reset(); onOpenChange(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { if (!o) reset(); onOpenChange(o) } }}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{versionOf ? `Unggah versi baru: ${versionOf.title}` : 'Unggah dokumen PDF'}</DialogTitle>
          <DialogDescription>
            Permohonan <span className="font-medium text-foreground">{applicationNumber}</span>. Hanya PDF, maksimal {maxMb} MB per file.
            {versionOf && ` Versi saat ini v${versionOf.version} tetap tersimpan sebagai riwayat.`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
            className={cn('flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors',
              dragging ? 'border-primary bg-accent' : 'border-input bg-muted/40')}
          >
            <UploadCloud className="size-8 text-primary" />
            <p className="text-sm font-medium">Tarik file PDF ke sini, atau</p>
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>Pilih file</Button>
            <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple={!versionOf} className="hidden"
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
          </div>

          {items.length > 0 && (
            <ul className="space-y-3">
              {items.map((it) => (
                <li key={it.key} className={cn('rounded-lg border p-3', it.status === 'done' && 'border-[#b9e1cc] bg-[#f3fbf7]', it.status === 'error' && 'border-[#f1c3bf]')}>
                  <div className="flex items-start gap-3">
                    <FileText className="mt-0.5 size-5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <p className="truncate text-sm font-medium">{it.file.name}</p>
                        <span className="text-xs text-muted-foreground tabular">
                          {formatBytes(it.file.size)}{it.check?.pageCount ? ` · ${it.check.pageCount} halaman` : ''}
                        </span>
                        {it.checking && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Memeriksa</span>}
                        {it.check && !it.check.ok && <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive"><XCircle className="size-3.5" /> {it.check.message}</span>}
                        {it.status === 'uploading' && <span className="inline-flex items-center gap-1 text-xs text-primary"><Loader2 className="size-3 animate-spin" /> Mengunggah</span>}
                        {it.status === 'done' && <span className="inline-flex items-center gap-1 text-xs font-medium text-success"><CheckCircle2 className="size-3.5" /> Tersimpan</span>}
                      </div>
                      {it.duplicateOf && it.status !== 'done' && (
                        <p className="mt-1 text-xs text-warning">File identik sudah ada di berkas ini: {it.duplicateOf}. Tetap dapat diunggah bila memang perlu.</p>
                      )}
                      {it.error && <p className="mt-1 text-xs text-destructive">{it.error}</p>}
                      {it.check?.ok && it.status !== 'done' && (
                        <div className="mt-2 grid gap-2 sm:grid-cols-[1.1fr_1.6fr_1fr_0.9fr]">
                          <NativeSelect aria-label="Kategori" value={it.category} disabled={!!versionOf || busy}
                            onChange={(e) => update(it.key, { category: e.target.value as DocumentCategory })}>
                            {DOCUMENT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                          </NativeSelect>
                          <Input aria-label="Judul dokumen" value={it.title} disabled={busy} onChange={(e) => update(it.key, { title: e.target.value })} placeholder="Judul dokumen" />
                          <Input aria-label="Nomor dokumen" value={it.documentNumber} disabled={busy} onChange={(e) => update(it.key, { documentNumber: e.target.value })} placeholder="Nomor dokumen (opsional)" />
                          <Input aria-label="Tanggal dokumen" type="date" value={it.documentDate} disabled={busy} onChange={(e) => update(it.key, { documentDate: e.target.value })} />
                        </div>
                      )}
                    </div>
                    {it.status !== 'uploading' && it.status !== 'done' && (
                      <Button variant="ghost" size="icon-sm" aria-label="Hapus dari daftar" disabled={busy}
                        onClick={() => setItems((p) => p.filter((x) => x.key !== it.key))}><Trash2 /></Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="up-access">Tingkat akses</label>
              <NativeSelect id="up-access" value={access} disabled={busy} onChange={(e) => setAccess(e.target.value as AccessLevel)}>
                {ACCESS_LEVELS.filter((a) => a.value !== 'rahasia' || can('documents.secret')).map((a) => (
                  <option key={a.value} value={a.value}>{a.label} — {a.hint}</option>
                ))}
              </NativeSelect>
            </div>
            {versionOf ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="up-note">Alasan perubahan <span className="text-destructive">*</span></label>
                <Input id="up-note" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="Contoh: hasil pindai ulang, revisi SK" />
              </div>
            ) : (
              <div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="up-desc">Keterangan (semua file)</label>
                <Textarea id="up-desc" rows={1} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            )}
          </div>
          {versionOf && <p className="text-xs text-muted-foreground">Kategori: {categoryLabel(versionOf.category)}</p>}
          {busy && <Progress value={(done / Math.max(1, ready.length + done)) * 100} />}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false) }} disabled={busy}>Tutup</Button>
          <Button onClick={submit} loading={busy} disabled={!ready.length || items.some((i) => i.checking)}>
            {versionOf ? 'Simpan versi baru' : `Unggah ${ready.length || ''} dokumen`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
