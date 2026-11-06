import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FileDown, FileSpreadsheet, Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { logActivity } from '@/lib/activity'
import { formatNumber, todayIso } from '@/lib/format'
import { APPLICATION_TYPES } from '@/lib/constants'
import {
  MAX_DAYS, buildColumns, buildMatrix, daysBetween, periodLabel,
  type DailyCount, type Granularity, type PermitTypeLite, type RowDimension,
} from '@/lib/recap'
import { exportRecapExcel, exportRecapPdf, type PaperSize, type Signatories } from '@/lib/recapExport'
import { SignatoryFields } from '@/components/common/SignatoryFields'
import { useAuth } from '@/hooks/useAuth'
import { useSettings } from '@/hooks/useSettings'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/States'
import { FormField } from '@/components/common/FormField'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input, NativeSelect } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip } from '@/components/ui/misc'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const GRAN_LABEL: Record<Granularity, string> = { day: 'Harian', week: 'Mingguan', month: 'Bulanan' }
const DIM_LABEL: Record<RowDimension, string> = { permit_type: 'JENIS IZIN', location: 'LOKASI IZIN', district: 'KECAMATAN' }

function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }
}
const thisMonth = () => todayIso().slice(0, 7)
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

async function fetchCounts(from: string, to: string, basis: string) {
  const out: DailyCount[] = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .rpc('report_daily_counts', { p_from: from, p_to: to, p_basis: basis })
      .order('day').order('permit_type_id').order('application_type').order('location', { nullsFirst: true })
      .range(start, start + 999)
    if (error) throw error
    out.push(...(data as DailyCount[]))
    if (data.length < 1000) break
  }
  return out
}


const OSS_FIXED: PermitTypeLite[] = [
  { id: 'oss:nib', name: 'Nomor Induk Berusaha (NIB)', sector: '', report_group: 'PERIZINAN BERUSAHA BERBASIS RISIKO (OSS)', report_order: 1, is_active: true, group_order: 0 },
  { id: 'oss:ss_mr', name: 'Sertifikat Standar (Menengah Rendah)', sector: '', report_group: 'PERIZINAN BERUSAHA BERBASIS RISIKO (OSS)', report_order: 2, is_active: true, group_order: 0 },
  { id: 'oss:ss_mt', name: 'Sertifikat Standar (Menengah Tinggi)', sector: '', report_group: 'PERIZINAN BERUSAHA BERBASIS RISIKO (OSS)', report_order: 3, is_active: true, group_order: 0 },
  { id: 'oss:izin', name: 'Izin (OSS)', sector: '', report_group: 'PERIZINAN BERUSAHA BERBASIS RISIKO (OSS)', report_order: 4, is_active: true, group_order: 0 },
  { id: 'oss:pd:pkkpr darat', name: 'PKKPR Darat', sector: '', report_group: 'PERSYARATAN DASAR PERIZINAN BERUSAHA (OSS)', report_order: 1, is_active: true, group_order: 1 },
  { id: 'oss:pd:sppl', name: 'SPPL', sector: '', report_group: 'PERSYARATAN DASAR PERIZINAN BERUSAHA (OSS)', report_order: 2, is_active: true, group_order: 1 },
  { id: 'oss:pd:pernyataan mandiri skala mikro', name: 'Pernyataan Mandiri Skala Mikro', sector: '', report_group: 'PERSYARATAN DASAR PERIZINAN BERUSAHA (OSS)', report_order: 3, is_active: true, group_order: 1 },
]

interface OssCountRow { day: string; category: string; label: string; section: string; location: string | null; total: number }

async function fetchOssCounts(from: string, to: string) {
  const rows: OssCountRow[] = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase.rpc('report_oss_daily_counts', { p_from: from, p_to: to })
      .order('day').order('category').order('location', { nullsFirst: true }).range(start, start + 999)
    if (error) throw error
    rows.push(...(data as OssCountRow[]))
    if (data.length < 1000) break
  }
  const types = new Map(OSS_FIXED.map((t) => [t.id, t]))
  rows.forEach((r) => {
    if (!types.has(r.category)) {
      types.set(r.category, { id: r.category, name: r.label, sector: '', report_group: r.section, report_order: 9, is_active: true, group_order: r.section.startsWith('PERSYARATAN') ? 1 : 0 })
    }
  })
  const counts: DailyCount[] = rows.map((r) => ({ day: r.day, permit_type_id: r.category, application_type: 'OSS', location: r.location, total: Number(r.total) }))
  return { counts, types: Array.from(types.values()) }
}

export default function RecapPage() {
  const { profile, role } = useAuth()
  const { data: settings } = useSettings()
  const qc = useQueryClient()
  const initial = monthRange(thisMonth())
  const [gran, setGran] = useState<Granularity>('day')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [basis, setBasis] = useState<'issued' | 'application'>('issued')
  const [source, setSource] = useState<'sicantik' | 'oss' | 'all'>('sicantik')
  const useSic = source !== 'oss'
  const useOss = source !== 'sicantik'
  const [dim, setDim] = useState<RowDimension>('permit_type')
  const [sector, setSector] = useState('')
  const [appType, setAppType] = useState('')
  const [locQuery, setLocQuery] = useState('')
  const [showZero, setShowZero] = useState(true)
  const [pdfOpen, setPdfOpen] = useState(false)
  const [paper, setPaper] = useState<PaperSize>('a4')
  const [signDate, setSignDate] = useState(todayIso())
  const [sig, setSig] = useState<Signatories | null>(null)
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null)

  const nDays = from && to && to >= from ? daysBetween(from, to).length : 0
  const rangeError = !from || !to || to < from
    ? 'Tanggal akhir harus sama atau setelah tanggal awal.'
    : nDays > MAX_DAYS[gran]
      ? `Rekap ${GRAN_LABEL[gran].toLowerCase()} maksimal ${MAX_DAYS[gran]} hari. ${gran === 'day' ? 'Pilih satu bulan, atau gunakan rekap mingguan/bulanan.' : 'Persempit rentang tanggal.'}`
      : null

  const types = useQuery({
    queryKey: ['permit_types', 'recap'],
    queryFn: async () => {
      const { data, error } = await supabase.from('permit_types').select('id, name, sector, report_group, report_order, is_active').order('name')
      if (error) throw error
      return data as PermitTypeLite[]
    },
  })
  const sicCounts = useQuery({
    queryKey: ['recap', from, to, basis],
    enabled: !rangeError && useSic,
    queryFn: () => fetchCounts(from, to, basis),
  })
  const ossCounts = useQuery({
    queryKey: ['recap', 'oss', from, to],
    enabled: !rangeError && useOss,
    queryFn: () => fetchOssCounts(from, to),
  })
  const counts = {
    data: (useSic && !sicCounts.data) || (useOss && !ossCounts.data) ? undefined : [...(useSic ? sicCounts.data ?? [] : []), ...(useOss ? ossCounts.data?.counts ?? [] : [])],
    error: (useSic && sicCounts.error) || (useOss && ossCounts.error) || null,
    refetch: () => { void sicCounts.refetch(); void ossCounts.refetch() },
  }
  const ossTypes = ossCounts.data?.types

  const sectors = useMemo(() => Array.from(new Set(types.data?.map((t) => t.sector))).sort(), [types.data])
  const columns = useMemo(() => (rangeError ? [] : buildColumns(from, to, gran)), [from, to, gran, rangeError])
  const countsData = counts.data
  const matrix = useMemo(() => {
    if (!countsData || !types.data || rangeError) return null
    const typeMap = new Map(types.data.map((t) => [t.id, t]))
    const q = locQuery.trim().toLowerCase()
    // Filter sektor & jenis permohonan hanya berlaku untuk data SiCANTIK
    const filtered = countsData.filter((c) => {
      const isOss = c.permit_type_id.startsWith('oss:')
      return (isOss || !sector || typeMap.get(c.permit_type_id)?.sector === sector) &&
        (isOss || !appType || c.application_type === appType) &&
        (!q || (c.location ?? '').toLowerCase().includes(q))
    })
    const sicTypes = useSic ? (sector ? types.data.filter((t) => t.sector === sector) : types.data) : []
    return buildMatrix({
      counts: filtered, columns, dimension: dim,
      permitTypes: [...(useOss ? ossTypes ?? [] : []), ...sicTypes],
      locationRules: settings?.locationRules ?? [], showZeroRows: showZero,
    })
  }, [countsData, types.data, ossTypes, useSic, useOss, columns, dim, sector, appType, locQuery, showZero, settings?.locationRules, rangeError])

  const title = source === 'oss'
    ? `REKAPITULASI PERIZINAN BERUSAHA OSS ${GRAN_LABEL[gran].toUpperCase()}`
    : `REKAPITULASI ${basis === 'issued' ? 'IZIN TERBIT' : 'PERMOHONAN IZIN'} ${GRAN_LABEL[gran].toUpperCase()}`
  const subtitleParts = [
    dim === 'permit_type' ? 'Per jenis izin' : dim === 'location' ? 'Per lokasi izin' : 'Per kecamatan',
    sector && `sektor ${sector}`, appType && `jenis permohonan ${appType}`, locQuery.trim() && `lokasi memuat "${locQuery.trim()}"`,
    useSic && (basis === 'issued' ? 'berdasarkan tanggal penetapan' : 'berdasarkan tanggal permohonan'),
    source === 'all' ? 'sumber SiCANTIK & OSS RBA' : source === 'oss' ? 'sumber OSS RBA (tanggal terbit NIB/izin)' : 'sumber SiCANTIK',
  ].filter(Boolean)
  const subtitle = subtitleParts.join(' · ')
  const period = rangeError ? '' : periodLabel(from, to)
  const total = matrix?.find((r) => r.type === 'total')?.values.at(-1) ?? 0
  const fileBase = `rekap-${source === 'oss' ? 'oss' : basis === 'issued' ? 'izin-terbit' : 'permohonan'}${source === 'all' ? '-gabungan' : ''}-${gran === 'day' ? 'harian' : gran === 'week' ? 'mingguan' : 'bulanan'}-${from}_${to}`

  const docMeta = (s: Signatories) => ({
    title, period: `Periode: ${period}`, subtitle, rowHeader: DIM_LABEL[dim], identity: settings!.identity,
    signatories: s, signDate, generatedBy: profile?.full_name || profile?.email,
  })

  const doExport = async (kind: 'pdf' | 'xlsx', s: Signatories) => {
    if (!matrix || !settings) return
    setBusy(kind)
    try {
      if (kind === 'pdf') await exportRecapPdf(matrix, columns, docMeta(s), paper, fileBase)
      else await exportRecapExcel(matrix, columns, docMeta(s), fileBase)
      void logActivity('report.export', 'system', null, `Ekspor ${kind.toUpperCase()} ${title.toLowerCase()} periode ${period}`, { from, to, gran, basis, dim })
      toast.success(kind === 'pdf' ? 'PDF siap dicetak dan ditandatangani.' : 'File Excel berhasil dibuat.')
      return true
    } catch (e) {
      toast.error(errorMessage(e))
      return false
    } finally {
      setBusy(null)
    }
  }

  const saveDefaultSignatories = async () => {
    const { error } = await supabase.from('system_settings').update({ value: sig }).eq('key', 'report.signatories')
    if (error) return void toast.error(errorMessage(error))
    toast.success('Penandatangan disimpan sebagai bawaan.')
    qc.invalidateQueries({ queryKey: ['system_settings'] })
  }

  const applyPreset = (p: 'this' | 'prev' | 'year') => {
    if (p === 'year') {
      const y = todayIso().slice(0, 4)
      setFrom(`${y}-01-01`); setTo(`${y}-12-31`); setGran('month')
      return
    }
    const r = monthRange(p === 'this' ? thisMonth() : prevMonth())
    setFrom(r.from); setTo(r.to)
  }

  return (
    <div>
      <PageHeader
        title="Rekap izin harian, mingguan, bulanan"
        description="Jumlah izin per jenis izin atau per lokasi untuk periode yang Anda pilih. Unduh PDF berkop dinas dengan kolom tanda tangan Kepala Dinas dan Kepala Bidang."
        actions={
          <>
            <Button variant="outline" disabled={!matrix || !!busy} loading={busy === 'xlsx'} onClick={() => settings && doExport('xlsx', settings.signatories)}><FileSpreadsheet /> Excel</Button>
            <Button disabled={!matrix || !!busy} onClick={() => { setSig(settings?.signatories ?? null); setPdfOpen(true) }}><FileDown /> Unduh PDF untuk ditandatangani</Button>
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="space-y-4 pt-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.4fr)]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-gran">Jenis rekap</Label>
              <NativeSelect id="rc-gran" value={gran} onChange={(e) => setGran(e.target.value as Granularity)}>
                <option value="day">Harian</option>
                <option value="week">Mingguan</option>
                <option value="month">Bulanan</option>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-from">Dari tanggal</Label>
              <Input id="rc-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-to">Sampai tanggal</Label>
              <Input id="rc-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-month">Atau pilih bulan</Label>
              <Input id="rc-month" type="month" value={from.slice(0, 7) === to.slice(0, 7) ? from.slice(0, 7) : ''}
                onChange={(e) => { if (e.target.value) { const r = monthRange(e.target.value); setFrom(r.from); setTo(r.to) } }} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Pintasan</span>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => applyPreset('this')}>Bulan ini</Button>
                <Button size="sm" variant="outline" onClick={() => applyPreset('prev')}>Bulan lalu</Button>
                <Button size="sm" variant="outline" onClick={() => applyPreset('year')}>Tahun ini</Button>
              </div>
            </div>
          </div>
          <div className="grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-6">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-source">Sumber data</Label>
              <NativeSelect id="rc-source" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                <option value="sicantik">SiCANTIK (izin non-berusaha)</option>
                <option value="oss">OSS RBA (perizinan berusaha)</option>
                <option value="all">Gabungan SiCANTIK + OSS</option>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-basis">Yang dihitung</Label>
              <NativeSelect id="rc-basis" disabled={!useSic} value={basis} onChange={(e) => setBasis(e.target.value as 'issued' | 'application')}>
                <option value="issued">Izin terbit (tanggal penetapan)</option>
                <option value="application">Permohonan masuk (tanggal permohonan)</option>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-dim">Baris laporan</Label>
              <NativeSelect id="rc-dim" value={dim} onChange={(e) => setDim(e.target.value as RowDimension)}>
                <option value="permit_type">Per jenis izin</option>
                <option value="location">Per lokasi izin</option>
                <option value="district">Per kecamatan</option>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-sector">Sektor</Label>
              <NativeSelect id="rc-sector" disabled={!useSic} value={sector} onChange={(e) => setSector(e.target.value)}>
                <option value="">Semua sektor</option>
                {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-type">Jenis permohonan</Label>
              <NativeSelect id="rc-type" disabled={!useSic} value={appType} onChange={(e) => setAppType(e.target.value)}>
                <option value="">Semua</option>
                {APPLICATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-loc">Lokasi izin memuat</Label>
              <Input id="rc-loc" value={locQuery} onChange={(e) => setLocQuery(e.target.value)} placeholder="mis. Wedomu, Atambua" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={showZero} onCheckedChange={(v) => setShowZero(!!v)} />
            {dim === 'permit_type' ? 'Tampilkan semua jenis izin aktif, termasuk yang nol' : dim === 'district' ? 'Tampilkan semua kecamatan, termasuk yang nol' : 'Tampilkan baris nol'}
          </label>
          {dim === 'district' && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Kecamatan ditentukan dari teks lokasi izin dengan aturan pola di Pengaturan → Aturan impor. Lokasi yang hanya berisi nama fasilitas
              (mis. “UPTD Puskesmas Wedomu”) masuk “Belum teridentifikasi” sampai polanya ditambahkan.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
          <div>
            <p className="text-sm font-bold">{title}</p>
            <p className="text-xs text-muted-foreground">{period && `Periode ${period}`} · {subtitle}</p>
          </div>
          {matrix && <p className="text-sm tabular"><span className="text-muted-foreground">Total </span><strong>{formatNumber(total)}</strong></p>}
        </div>
        {rangeError ? <p role="alert" className="p-6 text-sm text-destructive">{rangeError}</p>
          : counts.error || types.error ? <ErrorState error={counts.error ?? types.error} onRetry={() => counts.refetch()} />
          : !matrix ? <LoadingRows rows={10} cols={8} />
          : matrix.filter((r) => r.type === 'item').length === 0 ? <EmptyState title="Tidak ada data pada periode dan filter ini" />
          : (
            <div className="max-h-[70vh] overflow-auto">
              <table className="border-separate border-spacing-0 text-xs">
                <thead className="sticky top-0 z-20">
                  <tr>
                    <th rowSpan={2} className="sticky left-0 z-30 w-10 border-b border-r bg-[#e8eef7] px-2 py-1.5 text-center">No</th>
                    <th rowSpan={2} className="sticky left-10 z-30 min-w-72 border-b border-r bg-[#e8eef7] px-2 py-1.5 text-center">{DIM_LABEL[dim]}</th>
                    {columns.map((c) => (
                      <th key={c.key} className={cn('min-w-8 border-r px-1 pt-1.5 text-center font-semibold', c.subtotal ? 'bg-[#d9d9d9]' : 'bg-[#e8eef7]', c.kind === 'total' && 'min-w-12 bg-[#cbd8ec]')}>
                        <Tooltip content={c.title}><span>{c.top}</span></Tooltip>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {columns.map((c) => (
                      <th key={c.key} className={cn('border-b border-r px-1 pb-1.5 text-center font-semibold tabular whitespace-nowrap', c.subtotal ? 'bg-[#d9d9d9]' : 'bg-[#e8eef7]', c.kind === 'total' && 'bg-[#cbd8ec]')}>{c.bottom}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((r) => {
                    if (r.type === 'section') {
                      return (
                        <tr key={r.key}>
                          <td className="sticky left-0 z-10 border-b border-r bg-[#fafbfd] px-2 py-1.5 text-center font-bold">{r.number}</td>
                          <td colSpan={columns.length + 1} className="border-b bg-[#fafbfd] px-2 py-1.5 font-bold"><span className="sticky left-12">{r.label}</span></td>
                        </tr>
                      )
                    }
                    const strong = r.type !== 'item'
                    const rowBg = r.type === 'total' ? 'bg-[#d6e1f2]' : r.type === 'subtotal' ? 'bg-[#eef2f8]' : 'bg-card'
                    return (
                      <tr key={r.key} className={cn(r.type === 'item' && 'hover:[&>td]:bg-accent/60')}>
                        <td className={cn('sticky left-0 z-10 border-b border-r px-2 py-1 text-center', rowBg)}>{r.number}</td>
                        <td className={cn('sticky left-10 z-10 border-b border-r px-2 py-1', rowBg, strong && 'text-center font-bold')}>{r.label}</td>
                        {r.values.map((v, i) => {
                          const c = columns[i]
                          return (
                            <td key={c.key} className={cn('border-b border-r px-1 py-1 text-center tabular',
                              r.type === 'item' && c.subtotal ? 'bg-[#d9d9d9] font-semibold' : rowBg,
                              (strong || c.kind === 'total') && 'font-bold', v === 0 && r.type === 'item' && !c.subtotal && 'text-muted-foreground/40')}>
                              {c.kind === 'day' && v === 0 ? '' : v}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      <Dialog open={pdfOpen} onOpenChange={setPdfOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Unduh PDF rekap</DialogTitle>
            <DialogDescription>{title} · {period}</DialogDescription>
          </DialogHeader>
          {sig && (
            <DialogBody className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField label="Ukuran kertas" htmlFor="pdf-paper" hint={gran === 'day' ? 'Rekap harian: F4 atau A3 lebih lega.' : undefined}>
                  <NativeSelect id="pdf-paper" value={paper} onChange={(e) => setPaper(e.target.value as PaperSize)}>
                    <option value="a4">A4 lanskap</option>
                    <option value="f4">F4 / Folio lanskap</option>
                    <option value="a3">A3 lanskap</option>
                  </NativeSelect>
                </FormField>
                <FormField label="Tempat" htmlFor="pdf-city"><Input id="pdf-city" value={sig.city} onChange={(e) => setSig({ ...sig, city: e.target.value })} /></FormField>
                <FormField label="Tanggal tanda tangan" htmlFor="pdf-date"><Input id="pdf-date" type="date" value={signDate} onChange={(e) => setSignDate(e.target.value)} /></FormField>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <p className="mb-2 text-sm font-semibold">Kiri — mengetahui</p>
                  <SignatoryFields prefix="sig-a" value={sig.approver} onChange={(v) => setSig({ ...sig, approver: v })} />
                </div>
                <div>
                  <p className="mb-2 text-sm font-semibold">Kanan — pembuat laporan</p>
                  <SignatoryFields prefix="sig-p" value={sig.preparer} onChange={(v) => setSig({ ...sig, preparer: v })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Nama yang dikosongkan dicetak sebagai titik-titik agar dapat ditulis tangan.</p>
            </DialogBody>
          )}
          <DialogFooter>
            {role === 'super_admin' && <Button variant="ghost" className="sm:mr-auto" onClick={saveDefaultSignatories}>Simpan sebagai bawaan</Button>}
            <Button variant="outline" onClick={() => setPdfOpen(false)}>Batal</Button>
            <Button loading={busy === 'pdf'} onClick={async () => { if (sig && (await doExport('pdf', sig))) setPdfOpen(false) }}>Unduh PDF</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
