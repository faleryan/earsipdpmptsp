import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Download, FileSpreadsheet, Info, Save, UploadCloud,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { chunk, cn } from '@/lib/utils'
import { formatBytes, formatDateTime, formatNumber } from '@/lib/format'
import { autoMap, fieldLabel, type Mapping } from '@/lib/import/fields'
import { DATASETS, detectDataset, type DatasetKey } from '@/lib/import/datasets'
import { buildTable, guessHeaderRow, parseImportFile, type ParsedFile } from '@/lib/import/parse'
import { buildCanonicalRows, detectDateOrder, sampleValues, type CanonRow, type ClientIssue, type DateOrder } from '@/lib/import/normalize'
import { useAuth } from '@/hooks/useAuth'
import { useSettings } from '@/hooks/useSettings'
import { PageHeader } from '@/components/common/PageHeader'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ImportStatusBadge } from '@/components/common/Badges'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Progress } from '@/components/ui/misc'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { STATUS_META, downloadErrorReport, formatValue, type MappingTemplate, type PreviewResult, type RowStatus } from './importTypes'
import type { ImportBatch } from '@/types'

const STEPS = ['Unggah file', 'Pemetaan kolom', 'Validasi & pratinjau', 'Proses impor', 'Hasil']
const PREVIEW_CHUNK = 500

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-5 grid grid-cols-5 gap-2" aria-label="Tahapan impor">
      {STEPS.map((s, i) => {
        const n = i + 1
        const state = n < step ? 'done' : n === step ? 'current' : 'todo'
        return (
          <li key={s} aria-current={state === 'current' ? 'step' : undefined} className="min-w-0">
            <div className={cn('h-1.5 rounded-full', state === 'todo' ? 'bg-border' : 'bg-primary')} />
            <p className={cn('mt-2 truncate text-xs sm:text-sm', state === 'current' ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
              <span className="tabular">{n}.</span> {s}
            </p>
          </li>
        )
      })}
    </ol>
  )
}

export default function ImportPage() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  const { data: settings } = useSettings()
  const [step, setStep] = useState(1)

  // Langkah 1
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [parsing, setParsing] = useState(false)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [headerIndex, setHeaderIndex] = useState(0)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // Langkah 2
  const [mapping, setMapping] = useState<Mapping>({})
  const [matchKey, setMatchKey] = useState<'source_id' | 'application_number'>('source_id')
  const [dataset, setDataset] = useState<DatasetKey>('sicantik')
  const [dateDetected, setDateDetected] = useState(false)
  const def = DATASETS[dataset]
  const keyField = def.keyField(matchKey)
  const [dateOrder, setDateOrder] = useState<DateOrder>('dmy')
  const [saveTplOpen, setSaveTplOpen] = useState(false)
  const [tplName, setTplName] = useState('')

  // Langkah 3
  const [canon, setCanon] = useState<{ rows: CanonRow[]; issues: ClientIssue[] } | null>(null)
  const [results, setResults] = useState<Map<number, PreviewResult>>(new Map())
  const [previewProgress, setPreviewProgress] = useState<number | null>(null)
  const [tab, setTab] = useState<RowStatus | 'duplicate'>('new')
  const [page, setPage] = useState(1)

  // Langkah 4
  const [updateChanged, setUpdateChanged] = useState(true)
  const [overwrite, setOverwrite] = useState<Set<number>>(new Set())
  const [confirmAllConflicts, setConfirmAllConflicts] = useState(false)
  const [notes, setNotes] = useState('')
  const [commitProgress, setCommitProgress] = useState<number | null>(null)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [batch, setBatch] = useState<ImportBatch | null>(null)
  const [confirmStart, setConfirmStart] = useState(false)

  const sheet = parsed?.sheets[sheetIndex]
  const table = useMemo(() => (sheet ? buildTable(sheet, headerIndex) : null), [sheet, headerIndex])

  const templates = useQuery({
    queryKey: ['system_settings', 'import.mapping_templates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('system_settings').select('value').eq('key', 'import.mapping_templates').maybeSingle()
      if (error) throw error
      return (data?.value ?? []) as MappingTemplate[]
    },
  })

  const previous = useQuery({
    queryKey: ['import_batches', 'hash', parsed?.hash],
    enabled: !!parsed,
    queryFn: async () => {
      const { data, error } = await supabase.from('import_batches').select('id, file_name, created_at, status')
        .eq('file_hash', parsed!.hash).in('status', ['completed', 'completed_with_errors']).order('created_at', { ascending: false }).limit(1)
      if (error) throw error
      return (data[0] ?? null) as Pick<ImportBatch, 'id' | 'file_name' | 'created_at' | 'status'> | null
    },
  })

  // cegah meninggalkan halaman saat impor berjalan
  useEffect(() => {
    if (commitProgress === null) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [commitProgress])

  const resetAll = () => {
    setStep(1); setParsed(null); setMapping({}); setCanon(null); setResults(new Map()); setOverwrite(new Set())
    setBatch(null); setCommitError(null); setCommitProgress(null); setNotes(''); setPreviewProgress(null)
  }

  /* ----------------------------- Langkah 1 ----------------------------- */
  const onFile = async (file: File) => {
    setParsing(true)
    try {
      const p = await parseImportFile(file)
      setParsed(p)
      setSheetIndex(0)
      const hi = guessHeaderRow(p.sheets[0])
      setHeaderIndex(hi)
      setMapping({})
      const detected = detectDataset(buildTable(p.sheets[0], hi).headers)
      setDataset(detected)
      if (detected !== 'sicantik') toast.info(`Terdeteksi: ${DATASETS[detected].label}`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setParsing(false)
    }
  }

  const goToMapping = () => {
    if (!table) return
    if (!table.rows.length) return void toast.error('Tidak ada baris data di bawah baris judul yang dipilih.')
    if (table.rows.length > 50000) return void toast.error('Maksimal 50.000 baris per impor. Pecah file menjadi beberapa bagian.')
    const auto = autoMap(table.headers, def.fields)
    setMapping(auto)
    if (def.sicantik) setMatchKey(auto.source_id ? 'source_id' : 'application_number')
    const order = detectDateOrder(table, auto, def.fields)
    setDateDetected(Boolean(order))
    if (order) setDateOrder(order)
    setStep(2)
  }

  /* ----------------------------- Langkah 2 ----------------------------- */
  const requiredList = def.required(matchKey)
  const missingRequired = requiredList.filter((f) => !mapping[f])
  const datasetTemplates = (templates.data ?? []).filter((t) => (t.dataset ?? 'sicantik') === dataset)
  const duplicateSources = Object.entries(
    Object.values(mapping).reduce<Record<string, number>>((acc, h) => { if (h) acc[h] = (acc[h] ?? 0) + 1; return acc }, {}),
  ).filter(([, n]) => n > 1).map(([h]) => h)

  const applyTemplate = (name: string) => {
    const tpl = datasetTemplates.find((t) => t.name === name)
    if (!tpl || !table) return
    const next: Mapping = {}
    const missing: string[] = []
    Object.entries(tpl.mapping).forEach(([k, h]) => {
      if (table.headers.includes(h)) next[k] = h
      else missing.push(h)
    })
    setMapping(next)
    setMatchKey(tpl.match_key)
    setDateOrder(tpl.date_order)
    if (missing.length) toast.warning(`Kolom template tidak ditemukan di file: ${missing.join(', ')}`)
    else toast.success(`Template "${name}" diterapkan.`)
  }

  const saveTemplate = async () => {
    const name = tplName.trim()
    if (name.length < 3) return void toast.error('Nama template minimal 3 karakter.')
    const list = (templates.data ?? []).filter((t) => !(t.name === name && (t.dataset ?? 'sicantik') === dataset))
    list.push({ name, dataset, mapping: mapping as Record<string, string>, match_key: matchKey, date_order: dateOrder, created_at: new Date().toISOString() })
    const { error } = await supabase.from('system_settings').update({ value: list }).eq('key', 'import.mapping_templates')
    if (error) return void toast.error(errorMessage(error))
    toast.success('Template pemetaan disimpan.')
    setSaveTplOpen(false)
    setTplName('')
    qc.invalidateQueries({ queryKey: ['system_settings'] })
  }

  /* ----------------------------- Langkah 3 ----------------------------- */
  const runPreview = async () => {
    if (!table) return
    const built = buildCanonicalRows(table, mapping, { dateOrder, keyField, keyLabel: def.keyLabel(matchKey), fields: def.fields })
    setCanon(built)
    setResults(new Map())
    setOverwrite(new Set())
    setStep(3)
    setPreviewProgress(0)
    const map = new Map<number, PreviewResult>()
    try {
      const parts = chunk(built.rows, PREVIEW_CHUNK)
      for (let i = 0; i < parts.length; i++) {
        const { data, error } = def.sicantik
          ? await supabase.rpc('import_preview', { p_rows: parts[i], p_match_key: matchKey })
          : await supabase.rpc('oss_import_preview', { p_dataset: dataset, p_rows: parts[i] })
        if (error) throw error
        ;(data as PreviewResult[]).forEach((r) => map.set(r.row_number, r))
        setPreviewProgress(Math.round(((i + 1) / parts.length) * 100))
      }
      setResults(map)
      const counts = countBy(map)
      setTab(counts.new ? 'new' : counts.changed ? 'changed' : counts.conflict ? 'conflict' : counts.error ? 'error' : 'unchanged')
      setPage(1)
    } catch (e) {
      toast.error(`Pratinjau gagal: ${errorMessage(e)}`)
      setStep(2)
    } finally {
      setPreviewProgress(null)
    }
  }

  const counts = useMemo(() => countBy(results), [results])
  const warningCount = useMemo(() => Array.from(results.values()).reduce((n, r) => n + r.warnings.length, 0), [results])
  const tabRows = useMemo(() => {
    if (tab === 'duplicate') return []
    return Array.from(results.values()).filter((r) => r.status === tab).sort((a, b) => a.row_number - b.row_number)
  }, [results, tab])
  const canonByRow = useMemo(() => new Map(canon?.rows.map((r) => [r.row_number, r])), [canon])
  const conflictRows = useMemo(() => Array.from(results.values()).filter((r) => r.status === 'conflict').map((r) => r.row_number), [results])

  /* ----------------------------- Langkah 4 ----------------------------- */
  const startImport = async () => {
    if (!parsed || !canon) return
    setCommitError(null)
    setCommitProgress(0)
    let batchId: string | null = null
    try {
      const { data: b, error: be } = await supabase.from('import_batches').insert({
        file_name: parsed.fileName,
        file_size: parsed.size,
        file_hash: parsed.hash,
        sheet_name: sheet?.name ?? null,
        match_key: def.sicantik ? matchKey : 'source_id',
        dataset,
        source_system: def.sourceSystem,
        column_mapping: mapping,
        options: { update_changed: updateChanged, date_order: dateOrder, header_row: (sheet?.rows[headerIndex]?.rowNumber ?? 1), overwrite_confirmed: overwrite.size },
        total_rows: canon.rows.length + canon.issues.length,
        notes: notes || null,
        status: 'processing',
        started_at: new Date().toISOString(),
      }).select().single()
      if (be) throw be
      batchId = b.id as string

      // galat sisi klien (duplikat dalam file)
      for (const part of chunk(canon.issues, 500)) {
        const { error } = await supabase.from('import_errors').insert(part.map((i) => ({
          batch_id: batchId, row_number: i.row_number, source_id: (i.row[keyField] as string) ?? null,
          application_number: ((i.row.application_number ?? i.row.nib) as string) ?? null, severity: 'error', error_type: i.type,
          field: i.field ?? null, message: i.message, raw_data: i.row,
        })))
        if (error) throw error
      }

      // hanya kirim baris yang perlu diproses; status tetap dihitung ulang di server
      const size = Math.min(1000, Math.max(50, settings?.importChunkSize ?? 200))
      const parts = chunk(canon.rows, size)
      for (let i = 0; i < parts.length; i++) {
        const rowsInPart = parts[i]
        const ow = rowsInPart.map((r) => r.row_number).filter((n) => overwrite.has(n))
        const { error } = def.sicantik
          ? await supabase.rpc('import_commit_rows', {
            p_batch_id: batchId, p_rows: rowsInPart, p_options: { update_changed: updateChanged, overwrite_rows: ow },
          })
          : await supabase.rpc('oss_import_commit', {
            p_batch_id: batchId, p_dataset: dataset, p_rows: rowsInPart, p_options: { update_changed: updateChanged },
          })
        if (error) throw error
        setCommitProgress(Math.round(((i + 1) / parts.length) * 100))
      }
    } catch (e) {
      setCommitError(errorMessage(e))
    }
    if (batchId) {
      const { data: fin, error: fe } = await supabase.rpc('import_finalize_batch', { p_batch_id: batchId })
      if (fe) setCommitError((prev) => prev ?? errorMessage(fe))
      else setBatch(fin as ImportBatch)
    }
    setCommitProgress(null)
    qc.invalidateQueries()
    setStep(5)
  }

  /* ------------------------------- Render ------------------------------- */
  return (
    <div>
      <PageHeader
        title="Impor data SiCANTIK"
        description="Unggah file ekspor SiCANTIK Cloud (XLSX, XLS, atau CSV). Format kolom tidak harus sama: Anda memetakan kolom sumber ke data E-Arsip sebelum menyimpan."
        actions={<Button asChild variant="outline"><Link to="/impor/riwayat">Riwayat impor</Link></Button>}
      />
      <Stepper step={step} />

      {step === 1 && (
        <Card>
          <CardContent className="space-y-5 pt-5">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) void onFile(f) }}
              className={cn('flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center', dragging ? 'border-primary bg-accent' : 'border-input bg-muted/30')}
            >
              <UploadCloud className="size-10 text-primary" />
              <div>
                <p className="font-semibold">Tarik file ekspor SiCANTIK ke sini</p>
                <p className="text-sm text-muted-foreground">XLSX, XLS, atau CSV · maksimal 20 MB · 50.000 baris</p>
              </div>
              <Button onClick={() => fileInput.current?.click()} loading={parsing}><FileSpreadsheet /> Pilih file</Button>
              <input ref={fileInput} type="file" className="hidden" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
            </div>

            {parsed && sheet && table && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-3 text-sm">
                  <span className="font-semibold">{parsed.fileName}</span>
                  <span className="text-muted-foreground">{formatBytes(parsed.size)}</span>
                  <span className="text-muted-foreground tabular">{formatNumber(table.rows.length)} baris data · {table.headers.length} kolom</span>
                  <span className="text-xs text-muted-foreground">SHA-256 {parsed.hash.slice(0, 12)}…</span>
                </div>
                {previous.data && (
                  <p className="flex items-start gap-2 rounded-md border border-[#ecd3a6] bg-[#fffaf0] px-3 py-2 text-sm">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                    <span>File yang identik sudah pernah diimpor pada {formatDateTime(previous.data.created_at)}.{' '}
                      <Link className="text-primary hover:underline" to={`/impor/${previous.data.id}`}>Lihat batch tersebut</Link>.
                      Impor ulang aman: baris yang tidak berubah akan dilewati.</span>
                  </p>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-1.5 block text-sm font-medium" htmlFor="imp-dataset">Jenis data</label>
                    <NativeSelect id="imp-dataset" value={dataset} onChange={(e) => setDataset(e.target.value as DatasetKey)}>
                      {Object.values(DATASETS).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                    </NativeSelect>
                    <p className="mt-1.5 text-xs text-muted-foreground">{def.description} Ditentukan otomatis dari judul kolom; ubah bila keliru.</p>
                  </div>
                  {parsed.sheets.length > 1 && (
                    <div>
                      <label className="mb-1.5 block text-sm font-medium" htmlFor="imp-sheet">Sheet</label>
                      <NativeSelect id="imp-sheet" value={sheetIndex} onChange={(e) => { const i = Number(e.target.value); setSheetIndex(i); setHeaderIndex(guessHeaderRow(parsed.sheets[i])) }}>
                        {parsed.sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length} baris)</option>)}
                      </NativeSelect>
                    </div>
                  )}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium" htmlFor="imp-header">Baris judul kolom</label>
                    <NativeSelect id="imp-header" value={headerIndex} onChange={(e) => setHeaderIndex(Number(e.target.value))}>
                      {sheet.rows.slice(0, 20).map((r, i) => (
                        <option key={r.rowNumber} value={i}>Baris {r.rowNumber}: {r.cells.map((c) => c.text).filter(Boolean).slice(0, 4).join(' | ').slice(0, 70)}</option>
                      ))}
                    </NativeSelect>
                  </div>
                </div>
                <div className="overflow-hidden rounded-lg border">
                  <p className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">Cuplikan 5 baris pertama</p>
                  <Table>
                    <TableHeader><TableRow>{table.headers.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
                    <TableBody>
                      {table.rows.slice(0, 5).map((r) => (
                        <TableRow key={r.rowNumber}>{table.headers.map((h) => <TableCell key={h} className="max-w-56 truncate whitespace-nowrap text-xs">{r.values[h]?.text}</TableCell>)}</TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex justify-end"><Button onClick={goToMapping}>Lanjut ke pemetaan <ArrowRight /></Button></div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 2 && table && (
        <Card>
          <CardHeader>
            <CardTitle>Petakan kolom file ke data E-Arsip</CardTitle>
            <CardDescription>Kolom dengan nama yang dikenali sudah dipetakan otomatis. Periksa contoh nilai di sebelah kanan sebelum melanjutkan.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 rounded-lg border bg-muted/30 p-4 md:grid-cols-3">
              {!def.sicantik ? (
                <div>
                  <p className="mb-1.5 text-sm font-medium">Kunci pencocokan data</p>
                  <p className="rounded-md border bg-card px-3 py-2 text-sm">{def.keyLabel(matchKey)}</p>
                  <p className="mt-1.5 text-xs text-muted-foreground">{def.label}. Data OSS bersifat referensi: baris yang berubah di OSS dapat diperbarui, tidak diedit manual di E-Arsip.</p>
                </div>
              ) : (
              <div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="imp-key">Kunci pencocokan data</label>
                <NativeSelect id="imp-key" value={matchKey} onChange={(e) => setMatchKey(e.target.value as typeof matchKey)}>
                  <option value="source_id">ID SiCANTIK (disarankan)</option>
                  <option value="application_number">Nomor permohonan</option>
                </NativeSelect>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {matchKey === 'source_id'
                    ? 'Setiap ID dianggap satu arsip. Paling akurat untuk deteksi duplikat & perubahan.'
                    : 'Hati-hati: satu nomor permohonan bisa memuat beberapa izin di SiCANTIK.'}
                </p>
              </div>
              )}
              <div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="imp-date">Format tanggal teks</label>
                <NativeSelect id="imp-date" value={dateOrder} onChange={(e) => setDateOrder(e.target.value as DateOrder)}>
                  <option value="dmy">Hari/Bulan/Tahun (31/12/2026)</option>
                  <option value="mdy">Bulan/Hari/Tahun (12/31/2026)</option>
                </NativeSelect>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {dateDetected ? 'Terdeteksi otomatis dari isi file. ' : ''}Sel tanggal Excel, 2026-12-31, dan “24 April 2026” dibaca otomatis.
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="imp-tpl">Template pemetaan</label>
                <div className="flex gap-2">
                  <NativeSelect id="imp-tpl" defaultValue="" onChange={(e) => e.target.value && applyTemplate(e.target.value)}>
                    <option value="">{datasetTemplates.length ? 'Pilih template…' : 'Belum ada template'}</option>
                    {datasetTemplates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                  </NativeSelect>
                  <Button variant="outline" size="icon" aria-label="Simpan sebagai template" onClick={() => setSaveTplOpen(true)}><Save /></Button>
                </div>
              </div>
            </div>

            {Array.from(new Set(def.fields.map((f) => f.group))).map((group) => (
              <div key={group}>
                <p className="mb-2 text-sm font-semibold">{group}</p>
                <div className="divide-y rounded-lg border">
                  {def.fields.filter((f) => f.group === group).map((f) => {
                    const req = requiredList.includes(f.key)
                    const src = mapping[f.key]
                    const samples = src ? sampleValues(table, src) : []
                    return (
                      <div key={f.key} className="grid items-center gap-2 px-3 py-2.5 md:grid-cols-[14rem_16rem_1fr]">
                        <div>
                          <p className="text-sm font-medium">{f.label}{req && <span className="ml-0.5 text-destructive">*</span>}</p>
                          {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                        </div>
                        <NativeSelect aria-label={`Kolom sumber untuk ${f.label}`} value={src ?? ''}
                          aria-invalid={(req && !src) || (src ? duplicateSources.includes(src) : false) || undefined}
                          onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || undefined }))}>
                          <option value="">— Tidak dipetakan —</option>
                          {table.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                        </NativeSelect>
                        <p className="truncate text-xs text-muted-foreground">{samples.length ? samples.join('  ·  ') : src ? 'Kolom kosong' : ''}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {(missingRequired.length > 0 || duplicateSources.length > 0) && (
              <div role="alert" className="rounded-md border border-[#f1c3bf] bg-[#fdf0ef] px-3 py-2 text-sm text-destructive">
                {missingRequired.length > 0 && <p>Kolom wajib belum dipetakan: {missingRequired.map(fieldLabel).join(', ')}.</p>}
                {duplicateSources.length > 0 && <p>Satu kolom sumber dipakai lebih dari sekali: {duplicateSources.join(', ')}.</p>}
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft /> Kembali</Button>
              <Button onClick={runPreview} disabled={missingRequired.length > 0 || duplicateSources.length > 0}>Validasi & pratinjau <ArrowRight /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Hasil validasi</CardTitle>
            <CardDescription>Belum ada data yang disimpan. Periksa setiap kelompok, lalu lanjutkan untuk memilih tindakan.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {previewProgress !== null ? (
              <div className="space-y-2 py-8 text-center">
                <p className="text-sm text-muted-foreground">Membandingkan {formatNumber(canon?.rows.length ?? 0)} baris dengan arsip… {previewProgress}%</p>
                <Progress value={previewProgress} className="mx-auto max-w-md" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-6" role="tablist">
                  {((def.sicantik ? ['new', 'changed', 'conflict', 'unchanged', 'error'] : ['new', 'changed', 'unchanged', 'error']) as RowStatus[]).map((s) => (
                    <button key={s} role="tab" aria-selected={tab === s} onClick={() => { setTab(s); setPage(1) }}
                      className={cn('rounded-lg border px-3 py-2.5 text-left transition-colors', tab === s ? 'border-primary bg-accent' : 'hover:border-primary/40')}>
                      <p className={cn('text-xs font-medium', STATUS_META[s].tone)}>{STATUS_META[s].label}</p>
                      <p className="text-xl font-bold tabular">{formatNumber(counts[s] ?? 0)}</p>
                    </button>
                  ))}
                  <button role="tab" aria-selected={tab === 'duplicate'} onClick={() => setTab('duplicate')}
                    className={cn('rounded-lg border px-3 py-2.5 text-left', tab === 'duplicate' ? 'border-primary bg-accent' : 'hover:border-primary/40')}>
                    <p className="text-xs font-medium text-destructive">Duplikat dalam file</p>
                    <p className="text-xl font-bold tabular">{formatNumber(canon?.issues.length ?? 0)}</p>
                  </button>
                </div>
                {warningCount > 0 && (
                  <p className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Info className="mt-0.5 size-4 shrink-0 text-primary" />
                    {formatNumber(warningCount)} peringatan data (mis. NIK bukan 16 digit) — baris tetap diimpor dengan nilai tersebut dikosongkan, dan tercatat di laporan.
                  </p>
                )}
                <p className="text-sm text-muted-foreground">{tab === 'duplicate' ? 'Baris dengan kunci yang sudah muncul sebelumnya di file ini. Hanya kemunculan pertama yang diproses.' : STATUS_META[tab].description}</p>

                <div className="overflow-hidden rounded-lg border">
                  {tab === 'duplicate' ? (
                    <Table>
                      <TableHeader><TableRow><TableHead>Baris</TableHead><TableHead>Keterangan</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {canon?.issues.slice(0, 200).map((i) => <TableRow key={i.row_number}><TableCell className="tabular">{i.row_number}</TableCell><TableCell>{i.message}</TableCell></TableRow>)}
                        {!canon?.issues.length && <TableRow><TableCell colSpan={2} className="py-6 text-center text-muted-foreground">Tidak ada duplikat.</TableCell></TableRow>}
                      </TableBody>
                    </Table>
                  ) : (
                    <PreviewTable
                      display={def.display}
                      rows={tabRows.slice((page - 1) * 50, page * 50)}
                      canonByRow={canonByRow}
                      status={tab}
                      overwrite={overwrite}
                      onToggle={(n, v) => setOverwrite((s) => { const x = new Set(s); if (v) x.add(n); else x.delete(n); return x })}
                    />
                  )}
                  {tab !== 'duplicate' && tabRows.length > 50 && (
                    <div className="flex items-center justify-between border-t px-3 py-2 text-sm">
                      <span className="text-muted-foreground tabular">{formatNumber((page - 1) * 50 + 1)}–{formatNumber(Math.min(page * 50, tabRows.length))} dari {formatNumber(tabRows.length)}</span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Sebelumnya</Button>
                        <Button size="sm" variant="outline" disabled={page * 50 >= tabRows.length} onClick={() => setPage((p) => p + 1)}>Berikutnya</Button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep(2)}><ArrowLeft /> Ubah pemetaan</Button>
                  <Button onClick={() => setStep(4)} disabled={!results.size}>Lanjut ke opsi impor <ArrowRight /></Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {step === 4 && canon && (
        <Card>
          <CardHeader>
            <CardTitle>Tentukan tindakan</CardTitle>
            <CardDescription>Setiap potongan {settings?.importChunkSize ?? 200} baris disimpan dalam satu transaksi. Baris yang gagal tidak membatalkan baris lain dan tercatat di laporan.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-3">
              <Summary label="Ditambahkan" value={counts.new ?? 0} tone="text-primary" />
              <Summary label={updateChanged ? 'Diperbarui' : 'Dilewati (berubah)'} value={(counts.changed ?? 0) + overwrite.size} tone="text-[#8a5a12]" />
              <Summary label="Dilewati / gagal" value={(counts.unchanged ?? 0) + (counts.conflict ?? 0) - overwrite.size + (counts.error ?? 0) + canon.issues.length} tone="text-muted-foreground" />
            </div>

            <fieldset className="rounded-lg border p-4">
              <legend className="px-1 text-sm font-semibold">Data yang berubah di {def.short.split(' ')[0]} ({formatNumber(counts.changed ?? 0)} baris)</legend>
              <div className="mt-1 space-y-2 text-sm">
                <label className="flex items-start gap-2"><input type="radio" name="changed" className="mt-1" checked={updateChanged} onChange={() => setUpdateChanged(true)} />
                  <span><span className="font-medium">Perbarui</span> — terapkan perubahan dari SiCANTIK. Metadata arsip (klasifikasi, lokasi fisik, dokumen) tidak tersentuh.</span></label>
                <label className="flex items-start gap-2"><input type="radio" name="changed" className="mt-1" checked={!updateChanged} onChange={() => setUpdateChanged(false)} />
                  <span><span className="font-medium">Lewati</span> — biarkan data arsip apa adanya; baris dicatat sebagai dilewati.</span></label>
              </div>
            </fieldset>

            {def.sicantik && <fieldset className="rounded-lg border p-4">
              <legend className="px-1 text-sm font-semibold">Konflik dengan data yang diubah manual ({formatNumber(counts.conflict ?? 0)} baris)</legend>
              {counts.conflict ? (
                <div className="space-y-3 text-sm">
                  <p>Secara bawaan, konflik <strong>tidak ditimpa</strong>. {formatNumber(overwrite.size)} baris dipilih untuk ditimpa dengan data SiCANTIK.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setTab('conflict'); setStep(3) }}>Pilih per baris</Button>
                    {overwrite.size < conflictRows.length && <Button size="sm" variant="outline" onClick={() => setConfirmAllConflicts(true)}>Timpa semua konflik…</Button>}
                    {overwrite.size > 0 && <Button size="sm" variant="ghost" onClick={() => setOverwrite(new Set())}>Batalkan pilihan</Button>}
                  </div>
                </div>
              ) : <p className="text-sm text-muted-foreground">Tidak ada konflik.</p>}
            </fieldset>}

            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="imp-notes">Catatan impor (opsional)</label>
              <Textarea id="imp-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contoh: Ekspor SiCANTIK periode Januari–November 2026" />
            </div>

            {commitProgress !== null && (
              <div className="space-y-2 rounded-lg border bg-accent/50 p-4">
                <p className="text-sm font-medium">Menyimpan… {commitProgress}% — jangan tutup halaman ini.</p>
                <Progress value={commitProgress} />
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(3)} disabled={commitProgress !== null}><ArrowLeft /> Kembali</Button>
              <Button onClick={() => setConfirmStart(true)} loading={commitProgress !== null}>Mulai impor</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 5 && (
        <Card>
          <CardContent className="space-y-5 pt-6">
            {batch ? (
              <>
                <div className="flex items-start gap-3">
                  {batch.status === 'completed' ? <CheckCircle2 className="size-8 shrink-0 text-success" /> : <AlertTriangle className="size-8 shrink-0 text-warning" />}
                  <div>
                    <h2 className="text-lg font-bold">{batch.status === 'completed' ? 'Impor selesai' : batch.status === 'failed' ? 'Impor gagal' : 'Impor selesai dengan catatan'}</h2>
                    <p className="text-sm text-muted-foreground">{batch.file_name} · <ImportStatusBadge status={batch.status} /></p>
                  </div>
                </div>
                {commitError && <p role="alert" className="rounded-md border border-[#f1c3bf] bg-[#fdf0ef] px-3 py-2 text-sm text-destructive">Proses berhenti: {commitError}. Baris yang sudah tersimpan tetap tercatat dalam batch ini; impor ulang file yang sama untuk melanjutkan.</p>}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <Summary label="Baru" value={batch.inserted_count} tone="text-primary" />
                  <Summary label="Diperbarui" value={batch.updated_count} tone="text-[#8a5a12]" />
                  <Summary label="Tidak berubah" value={batch.unchanged_count} tone="text-muted-foreground" />
                  <Summary label="Dilewati" value={batch.skipped_count} tone="text-muted-foreground" />
                  <Summary label="Gagal" value={batch.failed_count} tone="text-destructive" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {(batch.failed_count > 0 || batch.skipped_count > 0 || batch.warning_count > 0) && (
                    <Button variant="outline" onClick={() => downloadErrorReport(batch.id, batch.file_name).catch((e) => toast.error(errorMessage(e)))}>
                      <Download /> Unduh laporan kesalahan
                    </Button>
                  )}
                  <Button variant="outline" asChild><Link to={`/impor/${batch.id}`}>Detail batch</Link></Button>
                  <Button variant="outline" asChild><Link to={def.resultLink(batch.id).to}>{def.resultLink(batch.id).label}</Link></Button>
                  <Button onClick={resetAll}>Impor file lain</Button>
                </div>
              </>
            ) : (
              <div>
                <p role="alert" className="text-sm text-destructive">{commitError ?? 'Impor tidak dapat dimulai.'}</p>
                <Button className="mt-3" onClick={() => setStep(4)}>Kembali</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={saveTplOpen} onOpenChange={setSaveTplOpen}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>Simpan template pemetaan</DialogTitle></DialogHeader>
          <DialogBody>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="tpl-name">Nama template</label>
            <Input id="tpl-name" value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Ekspor SiCANTIK — daftar izin" />
            <p className="mt-2 text-xs text-muted-foreground">Template dengan nama sama akan diganti. Disimpan oleh {profile?.full_name || profile?.email}.</p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveTplOpen(false)}>Batal</Button>
            <Button onClick={saveTemplate}>Simpan template</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmAllConflicts} onOpenChange={setConfirmAllConflicts}
        title="Timpa semua data manual?"
        description={<>Sebanyak <strong>{formatNumber(conflictRows.length)}</strong> arsip yang pernah diubah manual akan dikembalikan ke nilai dari SiCANTIK. Perubahan manual pada kolom-kolom tersebut hilang (tetap tercatat di audit trail).</>}
        confirmLabel="Ya, timpa semua" destructive
        onConfirm={() => setOverwrite(new Set(conflictRows))}
      />
      <ConfirmDialog
        open={confirmStart} onOpenChange={setConfirmStart}
        title="Mulai impor?"
        description={
          <ul className="list-disc space-y-1 pl-5">
            <li>{formatNumber(counts.new ?? 0)} arsip baru ditambahkan</li>
            <li>{formatNumber(counts.changed ?? 0)} arsip berubah akan {updateChanged ? 'diperbarui' : 'dilewati'}</li>
            <li>{formatNumber(overwrite.size)} data manual ditimpa; {formatNumber((counts.conflict ?? 0) - overwrite.size)} konflik dilewati</li>
            <li>{formatNumber((counts.error ?? 0) + (canon?.issues.length ?? 0))} baris gagal dicatat di laporan</li>
          </ul>
        }
        confirmLabel="Mulai impor"
        onConfirm={() => { void startImport() }}
      />
    </div>
  )
}

function countBy(map: Map<number, PreviewResult>) {
  const c: Partial<Record<RowStatus, number>> = {}
  map.forEach((r) => { c[r.status] = (c[r.status] ?? 0) + 1 })
  return c
}

function Summary({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <p className={cn('text-xs font-medium', tone)}>{label}</p>
      <p className="text-2xl font-bold tabular">{formatNumber(value)}</p>
    </div>
  )
}

function PreviewTable({
  rows, canonByRow, status, overwrite, onToggle, display,
}: {
  display: (r: CanonRow) => { title: string; subtitle?: string; meta?: string }
  rows: PreviewResult[]
  canonByRow: Map<number, CanonRow>
  status: RowStatus
  overwrite: Set<number>
  onToggle: (row: number, v: boolean) => void
}) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada baris pada kelompok ini.</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {status === 'conflict' && <TableHead className="w-10"><span className="sr-only">Timpa</span></TableHead>}
          <TableHead>Baris</TableHead>
          <TableHead>Data</TableHead>
          <TableHead>Keterangan data</TableHead>
          <TableHead>{status === 'error' ? 'Kesalahan' : status === 'changed' || status === 'conflict' ? 'Perubahan' : 'Keterangan'}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const c = canonByRow.get(r.row_number)
          const d = c ? display(c) : null
          return (
            <TableRow key={r.row_number}>
              {status === 'conflict' && (
                <TableCell>
                  <Checkbox aria-label={`Timpa baris ${r.row_number}`} checked={overwrite.has(r.row_number)} onCheckedChange={(v) => onToggle(r.row_number, !!v)} />
                </TableCell>
              )}
              <TableCell className="tabular">{r.row_number}</TableCell>
              <TableCell className="min-w-48">
                {r.application_id ? <Link className="text-primary hover:underline" to={`/permohonan/${r.application_id}`} target="_blank">{d?.title}</Link> : (d?.title || '—')}
                {d?.meta && <p className="line-clamp-1 text-xs text-muted-foreground tabular">{d.meta}</p>}
              </TableCell>
              <TableCell className="min-w-56">
                <p className="text-sm">{d?.subtitle || '—'}</p>
              </TableCell>
              <TableCell className="min-w-72 text-xs">
                {status === 'error' && r.errors.map((e, i) => <p key={i} className="text-destructive">{fieldLabel(e.field)}: {e.message}</p>)}
                {(status === 'changed' || status === 'conflict') && (
                  <ul className="space-y-0.5">
                    {r.reason === 'manual_record' && <li className="font-medium text-destructive">Arsip dibuat manual dengan nomor yang sama.</li>}
                    {r.changes.slice(0, 6).map((ch) => (
                      <li key={ch.field}>
                        <span className={cn('font-medium', r.conflict_fields.includes(ch.field) && 'text-destructive')}>{fieldLabel(ch.field)}</span>:{' '}
                        <span className="text-muted-foreground line-through">{formatValue(ch.old)}</span> → <span>{formatValue(ch.new)}</span>
                      </li>
                    ))}
                    {r.changes.length > 6 && <li className="text-muted-foreground">+{r.changes.length - 6} kolom lain</li>}
                  </ul>
                )}
                {(status === 'new' || status === 'unchanged') && (r.warnings.length
                  ? r.warnings.map((w, i) => <p key={i} className="text-[#8a5a12]">{w.message}</p>)
                  : <Badge variant="muted">{status === 'new' ? 'Siap ditambahkan' : 'Sama'}</Badge>)}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
