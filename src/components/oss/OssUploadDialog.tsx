import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, FileText, Loader2, Trash2, UploadCloud, XCircle } from 'lucide-react'
import { inspectPdf, type FileCheck } from '@/lib/documents'
import { guessOssCategory, uploadOssDocument } from '@/lib/ossDocuments'
import { errorMessage } from '@/lib/errors'
import { formatBytes, formatDate } from '@/lib/format'
import { ACCESS_LEVELS, OSS_DOC_CATEGORIES, categoryLabel } from '@/lib/constants'
import { useSettings } from '@/hooks/useSettings'
import { useAuth } from '@/hooks/useAuth'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { AccessLevel, OssDocument, OssPermitRow } from '@/types'

interface Item {
  key: string
  file: File
  category: string
  permitId: string
  title: string
  documentNumber: string
  documentDate: string
  check?: FileCheck
  status: 'checking' | 'ready' | 'uploading' | 'done' | 'error'
  error?: string
}

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  nib: string
  companyName: string
  permits: OssPermitRow[]
  defaultCategory?: string
  defaultPermitId?: string | null
  versionOf?: OssDocument | null
}

function categoryForPermit(p?: OssPermitRow) {
  return p ? guessOssCategory(`${p.document_name} ${p.permit_category}`) : null
}

export function OssUploadDialog({ open, onOpenChange, nib, companyName, permits, defaultCategory, defaultPermitId, versionOf }: Props) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const { data: settings } = useSettings()
  const maxMb = settings?.maxFileSizeMb ?? 25
  const [items, setItems] = useState<Item[]>([])
  const [access, setAccess] = useState<AccessLevel>(versionOf?.access_level ?? 'biasa')
  const [changeNote, setChangeNote] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const update = (key: string, patch: Partial<Item>) => setItems((p) => p.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  const add = (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, versionOf ? 1 : 20)
    const permit = permits.find((p) => p.id === defaultPermitId)
    const next: Item[] = list.map((file) => {
      const cat = versionOf?.category ?? defaultCategory ?? categoryForPermit(permit) ?? guessOssCategory(file.name)
      const pid = versionOf?.oss_permit_id ?? defaultPermitId ?? ''
      return {
        key: crypto.randomUUID(), file, category: cat, permitId: pid ?? '',
        title: versionOf?.title ?? (cat === 'nib' ? `NIB ${companyName}` : permit ? `${permit.document_name} — ${companyName}` : file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ')),
        documentNumber: versionOf?.document_number ?? (cat === 'nib' ? nib : ''), documentDate: '', status: 'checking',
      }
    })
    setItems((p) => (versionOf ? next : [...p, ...next]))
    next.forEach(async (it) => {
      const check = await inspectPdf(it.file, maxMb)
      update(it.key, { check, status: check.ok ? 'ready' : 'error', error: check.ok ? undefined : check.message })
    })
  }

  const ready = items.filter((i) => i.status === 'ready')
  const reset = () => { setItems([]); setChangeNote(''); setAccess(versionOf?.access_level ?? 'biasa') }

  const submit = async () => {
    if (versionOf && !changeNote.trim()) return void toast.error('Tuliskan alasan perubahan untuk versi baru.')
    setBusy(true)
    let ok = 0
    for (const it of ready) {
      update(it.key, { status: 'uploading' })
      try {
        await uploadOssDocument({
          file: it.file, nib, permitId: it.permitId || null, category: it.category, title: it.title.trim() || it.file.name,
          documentNumber: it.documentNumber, documentDate: it.documentDate, accessLevel: access,
          documentGroupId: versionOf?.document_group_id, changeNote: versionOf ? changeNote : undefined,
        }, it.check!)
        update(it.key, { status: 'done' })
        ok++
      } catch (e) {
        update(it.key, { status: 'error', error: errorMessage(e) })
      }
    }
    setBusy(false)
    qc.invalidateQueries({ queryKey: ['oss'] })
    if (ok) toast.success(versionOf ? 'Versi baru tersimpan.' : `${ok} dokumen OSS tersimpan.`)
    if (ok === ready.length) { reset(); onOpenChange(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { if (!o) reset(); onOpenChange(o) } }}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{versionOf ? `Unggah versi baru: ${versionOf.title}` : 'Unggah dokumen OSS'}</DialogTitle>
          <DialogDescription>{companyName} · NIB {nib}. Hanya PDF, maksimal {maxMb} MB per file.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files) }}
            className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-input bg-muted/40 px-6 py-7 text-center"
          >
            <UploadCloud className="size-8 text-primary" />
            <p className="text-sm font-medium">Tarik file PDF ke sini, atau</p>
            <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy}>Pilih file</Button>
            <input ref={input} type="file" accept="application/pdf,.pdf" multiple={!versionOf} className="hidden"
              onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = '' }} />
          </div>
          {items.map((it) => (
            <div key={it.key} className={cn('rounded-lg border p-3', it.status === 'done' && 'border-[#b9e1cc] bg-[#f3fbf7]', it.status === 'error' && 'border-[#f1c3bf]')}>
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 text-sm">
                    <span className="truncate font-medium">{it.file.name}</span>
                    <span className="text-xs text-muted-foreground tabular">{formatBytes(it.file.size)}{it.check?.pageCount ? ` · ${it.check.pageCount} hlm` : ''}</span>
                    {it.status === 'checking' && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Memeriksa</span>}
                    {it.status === 'uploading' && <span className="inline-flex items-center gap-1 text-xs text-primary"><Loader2 className="size-3 animate-spin" /> Mengunggah</span>}
                    {it.status === 'done' && <span className="inline-flex items-center gap-1 text-xs font-medium text-success"><CheckCircle2 className="size-3.5" /> Tersimpan</span>}
                    {it.status === 'error' && <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive"><XCircle className="size-3.5" /> {it.error}</span>}
                  </div>
                  {it.status === 'ready' && (
                    <div className="mt-2 grid gap-2 md:grid-cols-[1fr_1.4fr_1.6fr_1fr_0.9fr]">
                      <NativeSelect aria-label="Kategori" value={it.category} disabled={!!versionOf} onChange={(e) => update(it.key, { category: e.target.value })}>
                        {OSS_DOC_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </NativeSelect>
                      <NativeSelect aria-label="Izin OSS terkait" value={it.permitId} disabled={!!versionOf}
                        onChange={(e) => { const p = permits.find((x) => x.id === e.target.value); update(it.key, { permitId: e.target.value, category: categoryForPermit(p) ?? it.category }) }}>
                        <option value="">Tanpa izin terkait (dokumen pelaku usaha)</option>
                        {permits.map((p) => <option key={p.id} value={p.id}>{p.document_name} · {formatDate(p.permit_date)}</option>)}
                      </NativeSelect>
                      <Input aria-label="Judul dokumen" value={it.title} onChange={(e) => update(it.key, { title: e.target.value })} />
                      <Input aria-label="Nomor dokumen" placeholder="Nomor dokumen" value={it.documentNumber} onChange={(e) => update(it.key, { documentNumber: e.target.value })} />
                      <Input aria-label="Tanggal dokumen" type="date" value={it.documentDate} onChange={(e) => update(it.key, { documentDate: e.target.value })} />
                    </div>
                  )}
                </div>
                {it.status !== 'uploading' && it.status !== 'done' && (
                  <Button variant="ghost" size="icon-sm" aria-label="Hapus dari daftar" onClick={() => setItems((p) => p.filter((x) => x.key !== it.key))}><Trash2 /></Button>
                )}
              </div>
            </div>
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="oss-access">Tingkat akses</label>
              <NativeSelect id="oss-access" value={access} onChange={(e) => setAccess(e.target.value as AccessLevel)}>
                {ACCESS_LEVELS.filter((a) => a.value !== 'rahasia' || can('documents.secret')).map((a) => <option key={a.value} value={a.value}>{a.label} — {a.hint}</option>)}
              </NativeSelect>
            </div>
            {versionOf && (
              <div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="oss-note">Alasan perubahan <span className="text-destructive">*</span></label>
                <Input id="oss-note" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="Mis. NIB diperbarui di OSS" />
                <p className="mt-1 text-xs text-muted-foreground">Kategori: {categoryLabel(versionOf.category)} · versi saat ini v{versionOf.version}</p>
              </div>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => { reset(); onOpenChange(false) }}>Tutup</Button>
          <Button loading={busy} disabled={!ready.length || items.some((i) => i.status === 'checking')} onClick={submit}>
            {versionOf ? 'Simpan versi baru' : `Unggah ${ready.length || ''} dokumen`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
