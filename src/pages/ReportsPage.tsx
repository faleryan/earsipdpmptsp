import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { FileDown, FileSpreadsheet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { fetchAllArchive, type ArchiveFilters } from '@/lib/api'
import { exportExcel, exportPdf, type ExportColumn } from '@/lib/export'
import { logActivity } from '@/lib/activity'
import { errorMessage } from '@/lib/errors'
import { formatDate, formatNumber, shortPermitName } from '@/lib/format'
import { APPLICATION_STATUS } from '@/lib/constants'
import { useAuth } from '@/hooks/useAuth'
import { useSettings } from '@/hooks/useSettings'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/States'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { archiveExportColumns, archivePdfColumns } from '@/components/archive/archiveExport'
import type { ArchiveRow } from '@/types'

interface SummaryRow { label: string; applications: number; permits: number; documents: number; incomplete: number }

const GROUPS: Record<string, string> = {
  permit_type: 'Jenis izin', sector: 'Sektor', month: 'Bulan', year: 'Tahun', application_type: 'Jenis permohonan',
  status: 'Status permohonan', classification: 'Klasifikasi arsip',
}

const PRESETS: { key: string; title: string; description: string; dateField: 'application' | 'issued'; filters: ArchiveFilters }[] = [
  { key: 'permohonan', title: 'Daftar permohonan', description: 'Seluruh permohonan menurut tanggal permohonan.', dateField: 'application', filters: {} },
  { key: 'izin', title: 'Daftar izin terbit', description: 'Izin yang ditetapkan pada periode terpilih.', dateField: 'issued', filters: { hasPermit: 'yes' } },
  { key: 'proses', title: 'Permohonan belum terbit', description: 'Permohonan tanpa nomor izin.', dateField: 'application', filters: { status: 'proses' } },
  { key: 'tidak-lengkap', title: 'Berkas belum lengkap', description: 'Arsip yang kurang dokumen wajib.', dateField: 'application', filters: { complete: 'no' } },
  { key: 'tanpa-klasifikasi', title: 'Arsip belum diklasifikasikan', description: 'Untuk ditindaklanjuti Admin Arsip.', dateField: 'application', filters: { classificationId: 'none' } },
]

function groupLabel(group: string, label: string) {
  if (group === 'status') return APPLICATION_STATUS[label]?.label ?? label
  if (group === 'month' && /^\d{4}-\d{2}$/.test(label)) return formatDate(`${label}-01`, 'MMMM yyyy')
  return label
}

export default function ReportsPage() {
  const { profile, can } = useAuth()
  const { data: settings } = useSettings()
  const [group, setGroup] = useState('permit_type')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const reveal = can('pii.view')

  const summary = useQuery({
    queryKey: ['report_summary', group, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_summary', { p_from: from || null, p_to: to || null, p_group: group })
      if (error) throw error
      return (data as SummaryRow[]).map((r) => ({ ...r, label: groupLabel(group, r.label ?? '—') }))
    },
  })
  const rows = summary.data ?? []
  const totals = rows.reduce((t, r) => ({ applications: t.applications + Number(r.applications), permits: t.permits + Number(r.permits), documents: t.documents + Number(r.documents), incomplete: t.incomplete + Number(r.incomplete) }), { applications: 0, permits: 0, documents: 0, incomplete: 0 })
  const period = from || to ? `Periode ${from ? formatDate(from, 'd MMMM yyyy') : 'awal'} s.d. ${to ? formatDate(to, 'd MMMM yyyy') : 'sekarang'}` : 'Seluruh periode'

  const meta = (title: string, subtitle: string) => ({ title, subtitle, identity: settings!.identity, generatedBy: profile?.full_name || profile?.email })

  const exportSummary = async (kind: 'xlsx' | 'pdf') => {
    if (!settings) return
    setBusy(`sum-${kind}`)
    try {
      const cols: ExportColumn<SummaryRow>[] = [
        { header: GROUPS[group], value: (r) => r.label, width: 60 },
        { header: 'Permohonan', value: (r) => Number(r.applications), width: 12 },
        { header: 'Izin terbit', value: (r) => Number(r.permits), width: 12 },
        { header: 'Dokumen', value: (r) => Number(r.documents), width: 12 },
        { header: 'Belum lengkap', value: (r) => Number(r.incomplete), width: 14 },
      ]
      const all = [...rows, { label: 'JUMLAH', ...totals }]
      const title = `REKAPITULASI ARSIP PERIZINAN PER ${GROUPS[group].toUpperCase()}`
      if (kind === 'xlsx') await exportExcel(all, cols, meta(title, period), `rekap-${group}`)
      else await exportPdf(rows, cols, meta(title, period), `rekap-${group}`, { orientation: 'portrait', totals: ['', 'JUMLAH', totals.applications, totals.permits, totals.documents, totals.incomplete] })
      void logActivity('report.export', 'system', null, `Ekspor rekap per ${GROUPS[group]} (${kind})`, { group, from, to })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const exportPreset = async (p: (typeof PRESETS)[number], kind: 'xlsx' | 'pdf') => {
    if (!settings) return
    setBusy(`${p.key}-${kind}`)
    try {
      const f: ArchiveFilters = { ...p.filters }
      if (p.dateField === 'issued') { f.issuedFrom = from || undefined; f.issuedTo = to || undefined }
      else { f.dateFrom = from || undefined; f.dateTo = to || undefined }
      const data = (await fetchAllArchive(f, p.dateField === 'issued' ? 'issued_date' : 'application_date')) as unknown as ArchiveRow[]
      if (!data.length) return void toast.info('Tidak ada data pada periode ini.')
      const title = p.title.toUpperCase()
      const sub = `${period} — ${formatNumber(data.length)} data`
      if (kind === 'xlsx') await exportExcel(data, archiveExportColumns(reveal), meta(title, sub), p.key)
      else await exportPdf(data, archivePdfColumns(reveal), meta(title, sub), p.key)
      void logActivity('report.export', 'system', null, `Ekspor laporan "${p.title}" (${kind}, ${data.length} data)`, { preset: p.key, from, to })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <PageHeader title="Laporan" description="Rekapitulasi dan daftar arsip siap cetak dengan kop DPMPTSP Kabupaten Belu, dalam format Excel atau PDF." />
      <Card className="mb-4">
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-[repeat(2,minmax(0,12rem))_1fr] sm:items-end">
          <div className="flex flex-col gap-1.5"><Label htmlFor="r-from">Dari tanggal</Label><Input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="r-to">Sampai tanggal</Label><Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <p className="text-sm text-muted-foreground">{period}. Rekap dihitung dari tanggal permohonan; daftar izin terbit dari tanggal penetapan.</p>
        </CardContent>
      </Card>

      <Tabs defaultValue="rekap">
        <TabsList>
          <TabsTrigger value="rekap">Rekapitulasi</TabsTrigger>
          <TabsTrigger value="daftar">Daftar arsip</TabsTrigger>
        </TabsList>
        <TabsContent value="rekap">
          <Card>
            <CardHeader className="flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="r-group">Kelompokkan menurut</Label>
                <NativeSelect id="r-group" className="w-56" value={group} onChange={(e) => setGroup(e.target.value)}>
                  {Object.entries(GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </NativeSelect>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => exportSummary('xlsx')} loading={busy === 'sum-xlsx'} disabled={!rows.length}><FileSpreadsheet /> Excel</Button>
                <Button variant="outline" onClick={() => exportSummary('pdf')} loading={busy === 'sum-pdf'} disabled={!rows.length}><FileDown /> PDF</Button>
              </div>
            </CardHeader>
            <CardContent>
              {summary.isLoading ? <LoadingRows /> : summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : !rows.length ? (
                <EmptyState title="Tidak ada data pada periode ini" />
              ) : (
                <div className="space-y-5">
                  <div style={{ height: Math.min(560, Math.max(180, Math.min(rows.length, 15) * 36 + 40)) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={rows.slice(0, 15)} layout="vertical" margin={{ left: 8, right: 24 }} barCategoryGap={6}>
                        <CartesianGrid stroke="#e4e9f0" horizontal={false} />
                        <XAxis type="number" allowDecimals={false} tick={{ fill: '#5a6b82', fontSize: 12 }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="label" width={260} tick={{ fill: '#0f1e33', fontSize: 11 }} axisLine={false} tickLine={false}
                          tickFormatter={(v: string) => shortPermitName(v, 40)} />
                        <RTooltip contentStyle={{ borderRadius: 8, border: '1px solid #dce3ec', fontSize: 12 }} cursor={{ fill: '#eef3fa' }} />
                        <Bar dataKey="applications" name="Permohonan" fill="#1f6fd1" radius={[0, 3, 3, 0]} barSize={14} />
                        <Bar dataKey="permits" name="Izin terbit" fill="#0b2240" radius={[0, 3, 3, 0]} barSize={14} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="overflow-hidden rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{GROUPS[group]}</TableHead>
                          <TableHead className="text-right">Permohonan</TableHead>
                          <TableHead className="text-right">Izin terbit</TableHead>
                          <TableHead className="text-right">Dokumen</TableHead>
                          <TableHead className="text-right">Belum lengkap</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((r) => (
                          <TableRow key={r.label}>
                            <TableCell className="max-w-xl">{r.label}</TableCell>
                            <TableCell className="text-right tabular">{formatNumber(r.applications)}</TableCell>
                            <TableCell className="text-right tabular">{formatNumber(r.permits)}</TableCell>
                            <TableCell className="text-right tabular">{formatNumber(r.documents)}</TableCell>
                            <TableCell className="text-right tabular">{formatNumber(r.incomplete)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-accent/60 font-semibold hover:bg-accent/60">
                          <TableCell>Jumlah</TableCell>
                          <TableCell className="text-right tabular">{formatNumber(totals.applications)}</TableCell>
                          <TableCell className="text-right tabular">{formatNumber(totals.permits)}</TableCell>
                          <TableCell className="text-right tabular">{formatNumber(totals.documents)}</TableCell>
                          <TableCell className="text-right tabular">{formatNumber(totals.incomplete)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="daftar">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {PRESETS.map((p) => (
              <Card key={p.key}>
                <CardHeader>
                  <CardTitle>{p.title}</CardTitle>
                  <CardDescription>{p.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => exportPreset(p, 'xlsx')} loading={busy === `${p.key}-xlsx`} disabled={!!busy}><FileSpreadsheet /> Excel</Button>
                  <Button variant="outline" size="sm" onClick={() => exportPreset(p, 'pdf')} loading={busy === `${p.key}-pdf`} disabled={!!busy}><FileDown /> PDF</Button>
                  <Button variant="link" size="sm" asChild>
                    <Link to={`/pencarian?${new URLSearchParams(Object.entries({ ...p.filters, ...(p.dateField === 'issued' ? { issuedFrom: from, issuedTo: to } : { dateFrom: from, dateTo: to }) }).filter(([, v]) => v) as [string, string][]).toString()}`}>Lihat di pencarian</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
