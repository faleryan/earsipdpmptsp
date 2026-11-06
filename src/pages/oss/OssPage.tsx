import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FileCheck2, FileSpreadsheet, FileUp, FilesIcon, RotateCcw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { likePattern, pgrstQuote } from '@/lib/utils'
import { formatBytes, formatDate, formatDateTime, formatNumber, formatRupiah, formatRupiahShort } from '@/lib/format'
import { exportRawExcel } from '@/lib/export'
import { logActivity } from '@/lib/activity'
import { useAuth } from '@/hooks/useAuth'
import { useDebounce } from '@/hooks/useDebounce'
import { usePagedList } from '@/hooks/usePagedList'
import { PageHeader } from '@/components/common/PageHeader'
import { DataTable, Pagination, type Column } from '@/components/common/DataTable'
import { SearchInput } from '@/components/common/SearchInput'
import { EmptyState } from '@/components/common/States'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { OssBulkUploadDialog } from '@/components/oss/OssBulkUploadDialog'
import type { OssBusinessRow, OssPermitRow, OssProjectRow, OssSummary } from '@/types'

export const KECAMATAN_BELU = ['Atambua Barat', 'Atambua Selatan', 'Kakuluk Mesak', 'Kota Atambua', 'Lamaknen', 'Lamaknen Selatan', 'Lasiolat',
  'Nanaet Duabesi', 'Raihat', 'Raimanuk', 'Tasifeto Barat', 'Tasifeto Timur']

const RISK: Record<string, { label: string; variant: 'success' | 'default' | 'warning' | 'danger' | 'muted' }> = {
  R: { label: 'Rendah', variant: 'success' }, Rendah: { label: 'Rendah', variant: 'success' },
  MR: { label: 'Menengah rendah', variant: 'default' }, 'Menengah Rendah': { label: 'Menengah rendah', variant: 'default' },
  MT: { label: 'Menengah tinggi', variant: 'warning' }, 'Menengah Tinggi': { label: 'Menengah tinggi', variant: 'warning' },
  T: { label: 'Tinggi', variant: 'danger' }, Tinggi: { label: 'Tinggi', variant: 'danger' },
}
export function RiskBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  const r = RISK[value] ?? { label: value, variant: 'muted' as const }
  return <Badge variant={r.variant}>{r.label}</Badge>
}
export function OssStatusBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  const v = /menunggu|proses/i.test(value) ? 'warning' : /tolak|batal|cabut/i.test(value) ? 'danger' : 'success'
  return <Badge variant={v}>{value}</Badge>
}

type Tab = 'izin' | 'proyek' | 'pelaku'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any

interface Filters { q: string; kecamatan: string; from: string; to: string; risk: string; category: string; document: string; status: string; scale: string; nibFile: string }

function applyFilters(tab: Tab, query: Q, f: Filters): Q {
  let x = query
  const s = f.q.trim()
  if (s) {
    const p = pgrstQuote(likePattern(s))
    if (tab === 'izin') x = x.or(`company_name.ilike.${p},nib.ilike.${p},permit_request_id.ilike.${p},document_name.ilike.${p},kbli.ilike.${p},project_name.ilike.${p},kelurahan.ilike.${p}`)
    if (tab === 'proyek') x = x.or(`company_name.ilike.${p},nib.ilike.${p},project_id.ilike.${p},project_name.ilike.${p},kbli.ilike.${p},kbli_title.ilike.${p},kelurahan.ilike.${p}`)
    if (tab === 'pelaku') x = x.or(`name.ilike.${p},nib.ilike.${p},kelurahan.ilike.${p},address.ilike.${p}`)
  }
  if (f.kecamatan) x = f.kecamatan === '__lain' ? x.not('kecamatan', 'in', `(${KECAMATAN_BELU.map((k) => `"${k}"`).join(',')})`) : x.eq('kecamatan', f.kecamatan)
  const dateCol = tab === 'izin' ? 'permit_date' : tab === 'proyek' ? 'submitted_date' : 'oss_issued_date'
  if (f.from) x = x.gte(dateCol, f.from)
  if (f.to) x = x.lte(dateCol, f.to)
  if (tab === 'izin') {
    if (f.risk) x = x.eq('risk_code', f.risk)
    if (f.category) x = x.ilike('permit_category', `${f.category}%`)
    if (f.document) x = x.eq('document_name', f.document)
    if (f.status) x = x.eq('permit_status', f.status)
  }
  if (tab === 'proyek') {
    if (f.risk) x = x.eq('risk_level', f.risk)
    if (f.scale) x = x.eq('business_scale', f.scale)
  }
  if (tab === 'pelaku' && f.scale) x = x.eq('business_scale', f.scale)
  if (tab === 'pelaku' && f.nibFile) x = x.eq('has_nib_document', f.nibFile === 'ada')
  if (tab === 'izin' && f.nibFile) x = f.nibFile === 'ada' ? x.gt('document_count', 0) : x.eq('document_count', 0)
  return x
}

const TABLE: Record<Tab, { view: string; sort: string; tie: string; title: string }> = {
  izin: { view: 'v_oss_permit', sort: 'permit_date', tie: 'id', title: 'Izin OSS' },
  proyek: { view: 'oss_projects', sort: 'submitted_date', tie: 'id', title: 'Proyek OSS' },
  pelaku: { view: 'v_oss_business', sort: 'oss_issued_date', tie: 'nib', title: 'Pelaku usaha OSS' },
}

function NibLink({ nib, children }: { nib: string | null; children: ReactNode }) {
  return nib ? <Link to={`/oss/nib/${nib}`} className="font-medium hover:text-primary hover:underline">{children}</Link> : <span className="font-medium">{children}</span>
}

const permitColumns: Column<OssPermitRow>[] = [
  { key: 'permit_date', header: 'Tanggal izin', sortable: true, cell: (r) => <span className="whitespace-nowrap tabular">{formatDate(r.permit_date)}</span> },
  {
    key: 'document_name', header: 'Dokumen', sortable: true,
    cell: (r) => <div className="min-w-52"><p className="font-medium">{r.document_name}</p><p className="text-xs text-muted-foreground">{r.permit_category} · <span className="tabular">{r.permit_request_id}</span></p></div>,
  },
  { key: 'company_name', header: 'Pelaku usaha', sortable: true, cell: (r) => <div className="min-w-44"><NibLink nib={r.nib}>{r.company_name}</NibLink><p className="text-xs text-muted-foreground tabular">{r.nib ? `NIB ${r.nib}` : 'NIB tidak tercantum'}</p></div> },
  { key: 'kbli', header: 'Proyek / KBLI', cell: (r) => <div className="min-w-52 max-w-72"><p className="line-clamp-1 text-sm">{r.project_name ?? '—'}</p><p className="line-clamp-1 text-xs text-muted-foreground">{r.kbli ? `${r.kbli} ${r.kbli_title ?? ''}` : '—'}</p></div> },
  { key: 'risk_code', header: 'Risiko', sortable: true, cell: (r) => <RiskBadge value={r.risk_code} /> },
  { key: 'permit_status', header: 'Status', sortable: true, cell: (r) => <OssStatusBadge value={r.permit_status} /> },
  { key: 'kecamatan', header: 'Lokasi', sortable: true, cell: (r) => <div className="min-w-32 text-sm"><p>{r.kelurahan ?? '—'}</p><p className="text-xs text-muted-foreground">{r.kecamatan ?? ''}</p></div> },
  { key: 'document_count', header: 'PDF', sortable: true, cell: (r) => r.document_count ? <Badge variant="default">{r.document_count}</Badge> : <span className="text-muted-foreground">—</span>, className: 'text-right', headClassName: 'text-right' },
]

const projectColumns: Column<OssProjectRow>[] = [
  { key: 'submitted_date', header: 'Diajukan', sortable: true, cell: (r) => <span className="whitespace-nowrap tabular">{formatDate(r.submitted_date)}</span> },
  { key: 'project_name', header: 'Proyek', sortable: true, cell: (r) => <div className="min-w-52"><p className="font-medium">{r.project_name ?? '—'}</p><p className="text-xs text-muted-foreground tabular">{r.project_id} · {r.project_type}</p></div> },
  { key: 'company_name', header: 'Pelaku usaha', sortable: true, cell: (r) => <div className="min-w-44"><NibLink nib={r.nib}>{r.company_name}</NibLink><p className="text-xs text-muted-foreground">{r.company_type}</p></div> },
  { key: 'kbli', header: 'KBLI', sortable: true, cell: (r) => <div className="min-w-56 max-w-72"><p className="tabular text-sm">{r.kbli}</p><p className="line-clamp-2 text-xs text-muted-foreground">{r.kbli_title}</p></div> },
  { key: 'risk_level', header: 'Risiko', sortable: true, cell: (r) => <RiskBadge value={r.risk_level} /> },
  { key: 'business_scale', header: 'Skala', sortable: true, cell: (r) => <span className="whitespace-nowrap text-sm">{r.business_scale ?? '—'}</span> },
  { key: 'investment', header: 'Investasi', sortable: true, cell: (r) => <span className="whitespace-nowrap tabular">{formatRupiah(r.investment)}</span>, className: 'text-right', headClassName: 'text-right' },
  { key: 'workers', header: 'TKI', sortable: true, cell: (r) => <span className="tabular">{r.workers ?? '—'}</span>, className: 'text-right', headClassName: 'text-right' },
  { key: 'kecamatan', header: 'Lokasi', sortable: true, cell: (r) => <div className="min-w-32 text-sm"><p>{r.kelurahan ?? '—'}</p><p className="text-xs text-muted-foreground">{r.kecamatan ?? ''}</p></div> },
]

const businessColumns: Column<OssBusinessRow>[] = [
  { key: 'name', header: 'Pelaku usaha', sortable: true, cell: (r) => <div className="min-w-52"><NibLink nib={r.nib}>{r.name}</NibLink><p className="text-xs text-muted-foreground tabular">NIB {r.nib}{!r.has_nib_record && ' · profil NIB belum diimpor'}</p></div> },
  {
    key: 'has_nib_document', header: 'File NIB', sortable: true,
    cell: (r) => r.has_nib_document ? <span className="inline-flex items-center gap-1 text-sm font-medium text-success"><FileCheck2 className="size-4" /> Ada</span> : <span className="text-sm text-muted-foreground">Belum</span>,
  },
  { key: 'oss_issued_date', header: 'NIB terbit', sortable: true, cell: (r) => <span className="whitespace-nowrap tabular">{formatDate(r.oss_issued_date)}</span> },
  { key: 'company_type', header: 'Jenis', sortable: true, cell: (r) => <span className="line-clamp-2 min-w-32 text-sm">{r.company_type ?? '—'}</span> },
  { key: 'business_scale', header: 'Skala', sortable: true, cell: (r) => <span className="whitespace-nowrap text-sm">{r.business_scale ?? '—'}</span> },
  { key: 'kecamatan', header: 'Kecamatan', sortable: true, cell: (r) => <span className="text-sm">{r.kecamatan ?? '—'}</span> },
  { key: 'project_count', header: 'Proyek', sortable: true, cell: (r) => <span className="tabular font-semibold">{r.project_count}</span>, className: 'text-right', headClassName: 'text-right' },
  { key: 'permit_count', header: 'Izin', sortable: true, cell: (r) => <span className="tabular font-semibold">{r.permit_count}</span>, className: 'text-right', headClassName: 'text-right' },
  { key: 'investment', header: 'Investasi', sortable: true, cell: (r) => <span className="whitespace-nowrap tabular">{r.investment ? formatRupiah(r.investment) : '—'}</span>, className: 'text-right', headClassName: 'text-right' },
]

export default function OssPage() {
  const { can, profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = (['izin', 'proyek', 'pelaku'].includes(params.get('tab') ?? '') ? params.get('tab') : 'izin') as Tab
  const [search, setSearch] = useState('')
  const q = useDebounce(search)
  const [f, setF] = useState<Omit<Filters, 'q'>>({ kecamatan: '', from: '', to: '', risk: '', category: '', document: '', status: '', scale: '', nibFile: '' })
  const filters: Filters = { ...f, q }
  const [exporting, setExporting] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const active = Object.values(f).some(Boolean) || q

  const summary = useQuery({
    queryKey: ['oss', 'summary'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_oss_summary', { p_year: null })
      if (error) throw error
      return data as OssSummary
    },
  })
  const docStats = useQuery({
    queryKey: ['oss', 'document-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_oss_document_stats')
      if (error) throw error
      return data as { documents: number; size: number; businesses: number; with_nib_document: number; per_category: { category: string; count: number }[] }
    },
  })
  const options = useQuery({
    queryKey: ['oss', 'options'],
    queryFn: async () => {
      const [docs, statuses] = await Promise.all([
        supabase.from('oss_permits').select('document_name').order('document_name').limit(2000),
        supabase.from('oss_permits').select('permit_status').limit(2000),
      ])
      return {
        documents: Array.from(new Set((docs.data ?? []).map((d) => d.document_name))).sort(),
        statuses: Array.from(new Set((statuses.data ?? []).map((d) => d.permit_status).filter(Boolean))).sort() as string[],
      }
    },
  })

  const cfg = TABLE[tab]
  const [total, setTotal] = useState(0)
  const switchTab = (t: Tab) => setParams({ tab: t }, { replace: true })

  const doExport = async () => {
    setExporting(true)
    try {
      const rows: Record<string, unknown>[] = []
      for (let i = 0; i < 30; i++) {
        const { data, error } = await applyFilters(tab, supabase.from(cfg.view).select('*'), filters).order(cfg.sort, { ascending: false }).order(cfg.tie).range(i * 1000, i * 1000 + 999)
        if (error) throw error
        rows.push(...data)
        if (data.length < 1000) break
      }
      const mapRow = (r: Record<string, unknown>): Record<string, unknown> => {
        if (tab === 'izin') return {
          'Tanggal Izin': formatDate(r.permit_date as string, 'dd/MM/yyyy'), 'ID Permohonan Izin': r.permit_request_id, 'Jenis Perizinan': r.permit_category,
          'Nama Dokumen': r.document_name, Risiko: r.risk_code, Status: r.permit_status, NIB: r.nib, 'Nama Perusahaan': r.company_name, 'ID Proyek': r.project_id,
          'Nama Proyek': r.project_name, KBLI: r.kbli, 'Judul KBLI': r.kbli_title, Kecamatan: r.kecamatan, Kelurahan: r.kelurahan, 'K/L Sektor': r.kl_sector,
        }
        if (tab === 'proyek') return {
          'Tanggal Pengajuan': formatDate(r.submitted_date as string, 'dd/MM/yyyy'), 'ID Proyek': r.project_id, 'Nama Proyek': r.project_name, 'Jenis Proyek': r.project_type,
          NIB: r.nib, 'Nama Perusahaan': r.company_name, 'Jenis Perusahaan': r.company_type, KBLI: r.kbli, 'Judul KBLI': r.kbli_title, Risiko: r.risk_level,
          Skala: r.business_scale, 'Investasi (Rp)': r.investment === null ? '' : Number(r.investment), TKI: r.workers, 'Luas Tanah': r.land_area === null ? '' : Number(r.land_area),
          Satuan: r.land_unit, Alamat: r.address, Kecamatan: r.kecamatan, Kelurahan: r.kelurahan, 'K/L Pembina': r.kl_sector,
        }
        return {
          NIB: r.nib, 'Nama Pelaku Usaha': r.name, 'NIB Terbit': formatDate(r.oss_issued_date as string, 'dd/MM/yyyy'), Jenis: r.company_type, Skala: r.business_scale,
          Alamat: r.address, Kecamatan: r.kecamatan, Kelurahan: r.kelurahan, 'Jumlah Proyek': r.project_count, 'Jumlah Izin': r.permit_count,
          'Investasi (Rp)': Number(r.investment ?? 0), TKI: r.workers, 'File NIB': r.has_nib_document ? 'Ada' : 'Belum',
        }
      }
      await exportRawExcel([{ name: cfg.title, rows: rows.map(mapRow) }], `oss-${tab}`)
      void logActivity('report.export', 'oss', null, `Ekspor ${cfg.title} (${rows.length} baris) oleh ${profile?.email}`, { tab, filters })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  const sm = summary.data
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'izin', label: 'Izin', count: sm?.permits },
    { key: 'proyek', label: 'Proyek', count: sm?.projects },
    { key: 'pelaku', label: 'Pelaku usaha (NIB)', count: sm?.businesses },
  ]

  return (
    <div>
      <PageHeader
        title="Data OSS RBA"
        description={<>Perizinan berusaha berbasis risiko dari ekspor OSS: NIB, proyek (KBLI & investasi), serta persyaratan dasar dan sertifikat standar. {sm?.last_import && `Impor terakhir ${formatDateTime(sm.last_import)}.`}</>}
        actions={
          <>
            <Button variant="outline" onClick={doExport} loading={exporting} disabled={!total}><FileSpreadsheet /> Excel</Button>
            {can('documents.upload') && <Button variant="outline" onClick={() => setBulkOpen(true)} disabled={!sm?.businesses}><FilesIcon /> Unggah file NIB massal</Button>}
            {can('import.run') && <Button asChild><Link to="/impor"><FileUp /> Impor data OSS</Link></Button>}
          </>
        }
      />

      {sm && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {[
            ['Pelaku usaha', formatNumber(sm.businesses), `${formatNumber(sm.new_nib)} profil NIB`],
            ['Proyek', formatNumber(sm.projects), `${sm.per_risk.map((r) => `${r.risk} ${r.count}`).slice(0, 2).join(' · ')}`],
            ['Izin OSS', formatNumber(sm.permits), sm.waiting ? `${sm.waiting} menunggu verifikasi` : 'Semua telah terbit'],
            ['Rencana investasi', formatRupiahShort(sm.investment), 'Akumulasi dari data proyek'],
            ['Tenaga kerja', formatNumber(sm.workers), 'Rencana TKI dari data proyek'],
            ['File NIB tersimpan', docStats.data ? `${formatNumber(docStats.data.with_nib_document)} / ${formatNumber(docStats.data.businesses)}` : '—',
              docStats.data ? `${formatNumber(docStats.data.documents)} PDF OSS · ${formatBytes(docStats.data.size)}` : 'Dokumen PDF OSS'],
          ].map(([l, v, h]) => (
            <div key={l} className="rounded-lg border bg-card p-4">
              <p className="text-sm font-medium text-muted-foreground">{l}</p>
              <p className="mt-1 text-2xl font-bold tabular">{v}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{h}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => switchTab(t.key)}
            className={cn('rounded-lg border px-4 py-2 text-sm font-medium transition-colors', tab === t.key ? 'border-primary bg-accent' : 'bg-card hover:border-primary/40')}>
            {t.label} {t.count !== undefined && <span className="ml-1 tabular text-muted-foreground">{formatNumber(t.count)}</span>}
          </button>
        ))}
      </div>

      <Card>
        <div className="flex flex-col gap-2 border-b p-3 lg:flex-row lg:flex-wrap lg:items-center">
          <SearchInput value={search} onChange={setSearch} className="lg:w-80"
            placeholder={tab === 'pelaku' ? 'Nama, NIB, desa/kelurahan' : tab === 'proyek' ? 'Nama proyek, KBLI, NIB, perusahaan' : 'Perusahaan, NIB, dokumen, KBLI, ID izin'} />
          <NativeSelect aria-label="Kecamatan" className="lg:w-44" value={f.kecamatan} onChange={set('kecamatan')}>
            <option value="">Semua kecamatan</option>
            {KECAMATAN_BELU.map((k) => <option key={k} value={k}>{k}</option>)}
            <option value="__lain">Lainnya / kosong</option>
          </NativeSelect>
          {tab === 'izin' && (
            <>
              <NativeSelect aria-label="Jenis perizinan" className="lg:w-44" value={f.category} onChange={set('category')}>
                <option value="">Semua jenis</option>
                <option value="Persyaratan Dasar">Persyaratan dasar</option>
                <option value="Sertifikat Standar">Sertifikat standar</option>
                <option value="Izin">Izin</option>
              </NativeSelect>
              <NativeSelect aria-label="Nama dokumen" className="lg:w-56" value={f.document} onChange={set('document')}>
                <option value="">Semua dokumen</option>
                {options.data?.documents.map((d) => <option key={d} value={d}>{d}</option>)}
              </NativeSelect>
              <NativeSelect aria-label="Status" className="lg:w-48" value={f.status} onChange={set('status')}>
                <option value="">Semua status</option>
                {options.data?.statuses.map((d) => <option key={d} value={d}>{d}</option>)}
              </NativeSelect>
            </>
          )}
          {tab !== 'pelaku' && (
            <NativeSelect aria-label="Risiko" className="lg:w-40" value={f.risk} onChange={set('risk')}>
              <option value="">Semua risiko</option>
              {(tab === 'izin' ? [['R', 'Rendah'], ['MR', 'Menengah rendah'], ['MT', 'Menengah tinggi'], ['T', 'Tinggi']] : [['Rendah', 'Rendah'], ['Menengah Rendah', 'Menengah rendah'], ['Menengah Tinggi', 'Menengah tinggi'], ['Tinggi', 'Tinggi']])
                .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </NativeSelect>
          )}
          {tab !== 'izin' && (
            <NativeSelect aria-label="Skala usaha" className="lg:w-40" value={f.scale} onChange={set('scale')}>
              <option value="">Semua skala</option>
              {['Usaha Mikro', 'Usaha Kecil', 'Usaha Menengah', 'Usaha Besar'].map((v) => <option key={v} value={v}>{v}</option>)}
            </NativeSelect>
          )}
          {tab !== 'proyek' && (
            <NativeSelect aria-label="File PDF" className="lg:w-40" value={f.nibFile} onChange={set('nibFile')}>
              <option value="">{tab === 'pelaku' ? 'Semua file NIB' : 'Semua dokumen PDF'}</option>
              <option value="ada">{tab === 'pelaku' ? 'File NIB ada' : 'Ada PDF'}</option>
              <option value="belum">{tab === 'pelaku' ? 'File NIB belum' : 'Belum ada PDF'}</option>
            </NativeSelect>
          )}
          <Input type="date" aria-label="Dari tanggal" className="lg:w-40" value={f.from} onChange={set('from')} />
          <Input type="date" aria-label="Sampai tanggal" className="lg:w-40" value={f.to} onChange={set('to')} />
          {active && <Button variant="ghost" onClick={() => { setSearch(''); setF({ kecamatan: '', from: '', to: '', risk: '', category: '', document: '', status: '', scale: '', nibFile: '' }) }}><RotateCcw /> Atur ulang</Button>}
        </div>
        <OssTable key={tab} tab={tab} filters={filters} active={Boolean(active)} canImport={can('import.run')} onTotal={setTotal} />
      </Card>
      <OssBulkUploadDialog open={bulkOpen} onOpenChange={setBulkOpen} />
    </div>
  )
}

function OssTable({ tab, filters, active, canImport, onTotal }: { tab: Tab; filters: Filters; active: boolean; canImport: boolean; onTotal: (n: number) => void }) {
  const navigate = useNavigate()
  const cfg = TABLE[tab]
  const list = usePagedList<OssPermitRow & OssProjectRow & OssBusinessRow>({
    queryKey: ['oss', tab, filters],
    defaultSort: { column: cfg.sort, ascending: false },
    tieBreaker: cfg.tie,
    build: () => applyFilters(tab, supabase.from(cfg.view).select('*', { count: 'exact' }), filters),
  })
  useEffect(() => { onTotal(list.total) }, [list.total, onTotal])
  return (
    <DataTable
      columns={(tab === 'izin' ? permitColumns : tab === 'proyek' ? projectColumns : businessColumns) as Column<OssPermitRow & OssProjectRow & OssBusinessRow>[]}
      rows={list.rows}
      rowKey={(r) => (tab === 'pelaku' ? r.nib : r.id)}
      loading={list.isFetching}
      error={list.error}
      onRetry={() => list.refetch()}
      sort={list.sort}
      onSortChange={list.setSort}
      onRowClick={(r) => r.nib && navigate(`/oss/nib/${r.nib}`)}
      empty={<EmptyState title={active ? 'Tidak ada data yang cocok' : 'Belum ada data OSS'}
        description={active ? 'Ubah kata kunci atau filter.' : 'Impor ekspor OSS (List izin, DP.NIB, DP.Proyek) melalui menu Impor data. Urutan impor bebas.'}
        action={!active && canImport ? <Button asChild><Link to="/impor">Impor data OSS</Link></Button> : undefined} />}
      footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} onPageSizeChange={list.setPageSize} />}
    />
  )
}
