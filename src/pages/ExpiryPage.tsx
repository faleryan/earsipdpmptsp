import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BellRing, CheckCircle2, FileDown, FileSpreadsheet, FolderOpen, MessageCircle, RotateCcw, Wand2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { likePattern, pgrstQuote } from '@/lib/utils'
import { formatDate, formatDateTime, formatNumber, todayIso } from '@/lib/format'
import { exportExcel, exportPdf, type ExportColumn } from '@/lib/export'
import { logActivity } from '@/lib/activity'
import { listPermitTypes } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useSettings } from '@/hooks/useSettings'
import { useDebounce } from '@/hooks/useDebounce'
import { usePagedList } from '@/hooks/usePagedList'
import { daysLeftLabel, daysLeftTone, useExpirySummary, waNumber } from '@/hooks/useExpiry'
import { PageHeader } from '@/components/common/PageHeader'
import { DataTable, Pagination, type Column } from '@/components/common/DataTable'
import { SearchInput } from '@/components/common/SearchInput'
import { EmptyState } from '@/components/common/States'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { NativeSelect, Textarea } from '@/components/ui/input'
import { Tooltip } from '@/components/ui/misc'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { PermitExpiryRow } from '@/types'

function addMonths(iso: string, m: number) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + m)
  return d.toISOString().slice(0, 10)
}

export function reminderMessage(r: PermitExpiryRow, agency: string) {
  const when = r.days_left < 0 ? `telah berakhir pada ${formatDate(r.valid_until, 'd MMMM yyyy')}` : `akan berakhir pada ${formatDate(r.valid_until, 'd MMMM yyyy')}`
  return `Yth. Bapak/Ibu ${r.applicant_name},\n\nKami dari ${agency} menginformasikan bahwa ${r.permit_type_name} nomor ${r.permit_number} ${when}.\n\nMohon segera mengajukan perpanjangan melalui layanan perizinan (SiCANTIK) atau datang ke Mal Pelayanan Publik/kantor DPMPTSP.\n\nTerima kasih.`
}

export default function ExpiryPage() {
  const { can, role } = useAuth()
  const { data: settings } = useSettings()
  const qc = useQueryClient()
  const summary = useExpirySummary()
  const [params, setParams] = useSearchParams()
  const thresholds = settings?.expiryThresholds ?? [6, 3, 1]
  const bucket = params.get('dalam') ?? String(thresholds[0])
  const [search, setSearch] = useState('')
  const q = useDebounce(search)
  const [typeId, setTypeId] = useState('')
  const [notified, setNotified] = useState('')
  const [showRenewed, setShowRenewed] = useState(false)
  const [marking, setMarking] = useState<PermitExpiryRow | null>(null)
  const [note, setNote] = useState('')
  const [recalcAll, setRecalcAll] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const today = summary.data?.today ?? todayIso()
  const canRemind = can('archive.write')
  const agency = settings?.identity.agency_short ?? 'DPMPTSP Kabupaten Belu'

  const types = useQuery({ queryKey: ['permit_types'], queryFn: listPermitTypes })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (query: any) => {
    let x = query
    if (bucket === 'lewat') x = x.lt('valid_until', today).eq('permit_status', 'aktif')
    else if (bucket !== 'semua') x = x.gte('valid_until', today).lte('valid_until', addMonths(today, Number(bucket))).eq('permit_status', 'aktif')
    if (!showRenewed) x = x.eq('is_renewed', false)
    if (typeId) x = x.eq('permit_type_id', typeId)
    if (notified === 'no') x = x.is('renewal_notified_at', null)
    if (notified === 'yes') x = x.not('renewal_notified_at', 'is', null)
    if (q.trim()) {
      const p = pgrstQuote(likePattern(q.trim()))
      x = x.or(`permit_number.ilike.${p},applicant_name.ilike.${p},permit_type_name.ilike.${p},company_name.ilike.${p},permit_location.ilike.${p}`)
    }
    return x
  }

  const list = usePagedList<PermitExpiryRow>({
    queryKey: ['expiry', 'list', bucket, today, q, typeId, notified, showRenewed],
    defaultSort: { column: 'valid_until', ascending: bucket !== 'lewat' },
    tieBreaker: 'permit_id',
    build: () => applyFilters(supabase.from('v_permit_expiry').select('*', { count: 'exact' })),
  })

  const mark = useMutation({
    mutationFn: async ({ row, clear }: { row: PermitExpiryRow; clear?: boolean }) => {
      const { error } = await supabase.rpc('mark_permit_reminded', { p_permit_id: row.permit_id, p_note: clear ? null : note || null, p_clear: !!clear })
      if (error) throw error
    },
    onSuccess: (_, v) => {
      toast.success(v.clear ? 'Tanda pengingat dibatalkan.' : 'Ditandai sudah diingatkan.')
      setMarking(null); setNote('')
      qc.invalidateQueries({ queryKey: ['expiry'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const openWa = (r: PermitExpiryRow) => {
    const n = waNumber(r.applicant_phone)
    if (!n) return void toast.error('Nomor HP pemegang izin tidak valid untuk WhatsApp.')
    window.open(`https://wa.me/${n}?text=${encodeURIComponent(reminderMessage(r, agency))}`, '_blank', 'noopener')
    setNote(`Dikirim pengingat WhatsApp ke ${r.applicant_phone}`)
    setMarking(r)
  }

  const exportRows = async (kind: 'xlsx' | 'pdf') => {
    if (!settings) return
    setBusy(kind)
    try {
      const rows: PermitExpiryRow[] = []
      for (let i = 0; i < 20; i++) {
        const { data, error } = await applyFilters(supabase.from('v_permit_expiry').select('*')).order('valid_until').order('permit_id').range(i * 1000, i * 1000 + 999)
        if (error) throw error
        rows.push(...(data as PermitExpiryRow[]))
        if (data.length < 1000) break
      }
      const cols: ExportColumn<PermitExpiryRow>[] = [
        { header: 'Nomor Izin', value: (r) => r.permit_number, width: 34 },
        { header: 'Jenis Izin', value: (r) => r.permit_type_name, width: 42 },
        { header: 'Pemegang Izin', value: (r) => r.company_name ? `${r.company_name} (${r.applicant_name})` : r.applicant_name, width: 30 },
        { header: 'No. HP', value: (r) => r.applicant_phone, width: 15 },
        { header: 'Lokasi Izin', value: (r) => r.permit_location, width: 28 },
        { header: 'Tgl Penetapan', value: (r) => formatDate(r.issued_date, 'dd/MM/yyyy'), width: 12 },
        { header: 'Berlaku s.d.', value: (r) => formatDate(r.valid_until, 'dd/MM/yyyy'), width: 12 },
        { header: 'Sisa', value: (r) => daysLeftLabel(r.days_left), width: 18 },
        { header: 'Pengingat', value: (r) => (r.renewal_notified_at ? `${formatDate(r.renewal_notified_at, 'dd/MM/yyyy')} ${r.renewal_note ?? ''}` : 'Belum'), width: 24 },
      ]
      const label = bucket === 'lewat' ? 'yang telah berakhir' : bucket === 'semua' ? 'seluruhnya' : `berakhir dalam ${bucket} bulan`
      const meta = { title: 'DAFTAR IZIN MENDEKATI AKHIR MASA BERLAKU', subtitle: `Izin ${label} per ${formatDate(today, 'd MMMM yyyy')} — ${rows.length} izin`, identity: settings.identity }
      if (kind === 'xlsx') await exportExcel(rows, cols, meta, 'masa-berlaku-izin')
      else await exportPdf(rows, cols, meta, 'masa-berlaku-izin')
      void logActivity('report.export', 'permits', null, `Ekspor daftar masa berlaku izin (${kind}, ${rows.length})`, { bucket })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const doRecalcAll = async () => {
    const withValidity = (types.data ?? []).filter((t) => t.validity_years)
    let total = 0
    for (const t of withValidity) {
      const { data, error } = await supabase.rpc('recalculate_permit_validity', { p_permit_type_id: t.id, p_overwrite: false })
      if (error) throw error
      total += Number(data)
    }
    toast.success(`${formatNumber(total)} izin diberi tanggal berakhir dari ${withValidity.length} jenis izin bermasa berlaku.`)
    qc.invalidateQueries({ queryKey: ['expiry'] })
  }

  const columns: Column<PermitExpiryRow>[] = [
    {
      key: 'valid_until', header: 'Berlaku sampai', sortable: true,
      cell: (r) => (
        <div className="whitespace-nowrap">
          <p className="font-semibold tabular">{formatDate(r.valid_until)}</p>
          <Badge variant={daysLeftTone(r.days_left)}>{daysLeftLabel(r.days_left)}</Badge>
        </div>
      ),
    },
    {
      key: 'permit_number', header: 'Izin', sortable: true,
      cell: (r) => (
        <div className="min-w-60 max-w-80">
          <p className="text-sm font-medium">{r.permit_number}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">{r.permit_type_name}</p>
          {r.is_renewed && <Badge variant="success" className="mt-0.5">Sudah diajukan perpanjangan ({r.renewal_application_number})</Badge>}
        </div>
      ),
    },
    {
      key: 'applicant_name', header: 'Pemegang izin', sortable: true,
      cell: (r) => (
        <div className="min-w-44">
          <p className="font-medium">{r.company_name ?? r.applicant_name}</p>
          {r.company_name && <p className="text-xs text-muted-foreground">{r.applicant_name}</p>}
          <p className="text-xs text-muted-foreground tabular">{r.applicant_phone ?? 'Tanpa nomor HP'}</p>
        </div>
      ),
    },
    { key: 'permit_location', header: 'Lokasi izin', cell: (r) => <span className="line-clamp-2 min-w-36 text-sm">{r.permit_location ?? '—'}</span> },
    {
      key: 'renewal_notified_at', header: 'Pengingat', sortable: true,
      cell: (r) => r.renewal_notified_at ? (
        <Tooltip content={r.renewal_note || 'Tanpa catatan'}>
          <span className="inline-flex items-center gap-1 text-sm text-success"><CheckCircle2 className="size-4" /> {formatDate(r.renewal_notified_at)}</span>
        </Tooltip>
      ) : <span className="text-sm text-muted-foreground">Belum</span>,
    },
    {
      key: 'actions', header: <span className="sr-only">Aksi</span>, className: 'text-right whitespace-nowrap',
      cell: (r) => (
        <>
          {canRemind && waNumber(r.applicant_phone) && (
            <Tooltip content="Kirim pengingat lewat WhatsApp"><Button variant="ghost" size="icon-sm" aria-label="Kirim pengingat WhatsApp" onClick={() => openWa(r)}><MessageCircle /></Button></Tooltip>
          )}
          {canRemind && (r.renewal_notified_at
            ? <Tooltip content="Batalkan tanda sudah diingatkan"><Button variant="ghost" size="icon-sm" aria-label="Batalkan tanda pengingat" onClick={() => mark.mutate({ row: r, clear: true })}><RotateCcw /></Button></Tooltip>
            : <Tooltip content="Tandai sudah diingatkan"><Button variant="ghost" size="icon-sm" aria-label="Tandai sudah diingatkan" onClick={() => { setNote(''); setMarking(r) }}><BellRing /></Button></Tooltip>)}
          <Button variant="ghost" size="icon-sm" aria-label="Buka berkas" asChild><Link to={`/permohonan/${r.application_id}`}><FolderOpen /></Link></Button>
        </>
      ),
    },
  ]

  const tabs = [
    ...[...thresholds].sort((a, b) => a - b).map((m) => ({ key: String(m), label: `≤ ${m} bulan`, count: summary.data?.buckets.find((b) => b.months === m)?.count })),
    { key: 'lewat', label: 'Sudah berakhir', count: summary.data?.expired },
    { key: 'semua', label: 'Semua bermasa berlaku', count: undefined },
  ]

  return (
    <div>
      <PageHeader
        title="Masa berlaku izin"
        description="Izin aktif yang akan berakhir dalam 6, 3, atau 1 bulan. Izin yang sudah diajukan perpanjangan oleh pemohon yang sama otomatis tidak dihitung."
        actions={
          <>
            <Button variant="outline" onClick={() => exportRows('xlsx')} loading={busy === 'xlsx'} disabled={!list.total}><FileSpreadsheet /> Excel</Button>
            <Button variant="outline" onClick={() => exportRows('pdf')} loading={busy === 'pdf'} disabled={!list.total}><FileDown /> PDF</Button>
          </>
        }
      />

      {Boolean(summary.data?.without_validity) && (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-[#ecd3a6] bg-[#fffaf0] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>
            <strong className="tabular">{formatNumber(summary.data!.without_validity)}</strong> izin aktif belum memiliki tanggal berakhir sehingga belum dapat diberi notifikasi.
            Isi <em>Masa berlaku (tahun)</em> pada <Link to="/jenis-izin" className="text-primary hover:underline">jenis perizinan</Link> — tanggal berakhir dihitung otomatis dari tanggal penetapan.
          </p>
          {can('master.manage') && <Button size="sm" variant="outline" onClick={() => setRecalcAll(true)}><Wand2 /> Hitung semua</Button>}
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={bucket === t.key}
            onClick={() => setParams({ dalam: t.key }, { replace: true })}
            className={cn('rounded-lg border px-4 py-2 text-left transition-colors', bucket === t.key ? 'border-primary bg-accent' : 'bg-card hover:border-primary/40')}>
            <p className="text-xs font-medium text-muted-foreground">{t.label}</p>
            {t.count !== undefined && <p className={cn('text-xl font-bold tabular', t.key === '1' && t.count ? 'text-destructive' : '')}>{formatNumber(t.count)}</p>}
          </button>
        ))}
      </div>

      <Card>
        <div className="flex flex-col gap-2 border-b p-3 md:flex-row md:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Nomor izin, pemegang, jenis izin, lokasi" className="md:w-96" />
          <NativeSelect aria-label="Jenis izin" className="md:w-72" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">Semua jenis izin</option>
            {types.data?.filter((t) => t.validity_years).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Status pengingat" className="md:w-48" value={notified} onChange={(e) => setNotified(e.target.value)}>
            <option value="">Semua status pengingat</option>
            <option value="no">Belum diingatkan</option>
            <option value="yes">Sudah diingatkan</option>
          </NativeSelect>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={showRenewed} onCheckedChange={(v) => setShowRenewed(!!v)} /> Tampilkan yang sudah diperpanjang</label>
        </div>
        <DataTable
          columns={columns} rows={list.rows} rowKey={(r) => r.permit_id} loading={list.isFetching} error={list.error} onRetry={() => list.refetch()}
          sort={list.sort} onSortChange={list.setSort}
          empty={<EmptyState title={bucket === 'lewat' ? 'Tidak ada izin yang sudah berakhir' : 'Tidak ada izin yang akan berakhir pada rentang ini'} description="Izin tanpa tanggal berakhir tidak masuk daftar ini." />}
          footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} onPageSizeChange={list.setPageSize} />}
        />
      </Card>

      <Dialog open={!!marking} onOpenChange={(o) => !o && setMarking(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Tandai sudah diingatkan</DialogTitle>
            <DialogDescription>{marking?.permit_number} · {marking?.applicant_name}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="rem-note">Catatan</label>
            <Textarea id="rem-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Mis. ditelepon, pemohon akan memperpanjang minggu depan" />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarking(null)}>Batal</Button>
            <Button loading={mark.isPending} onClick={() => marking && mark.mutate({ row: marking })}>Simpan tanda</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={recalcAll} onOpenChange={setRecalcAll}
        title="Hitung tanggal berakhir izin?"
        description="Untuk setiap jenis izin yang memiliki masa berlaku, izin terbit tanpa tanggal berakhir akan diberi tanggal = tanggal penetapan + masa berlaku. Tanggal yang sudah ada tidak diubah."
        confirmLabel="Hitung sekarang"
        onConfirm={async () => { try { await doRecalcAll() } catch (e) { toast.error(errorMessage(e)); throw e } }}
      />
      {role && <p className="mt-3 text-xs text-muted-foreground">Data per {formatDateTime(new Date().toISOString())} (WITA). Notifikasi diperbarui otomatis setiap 5 menit.</p>}
    </div>
  )
}
