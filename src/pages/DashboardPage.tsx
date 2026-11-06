import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts'
import { AlertCircle, FileBadge2, FileStack, FileUp, Hourglass, ClipboardList } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getArchiveYears } from '@/lib/api'
import { formatBytes, formatDate, formatDateTime, formatNumber, formatRelative, shortPermitName } from '@/lib/format'
import { ACTIVITY_LABELS, ENTITY_LABELS, categoryLabel } from '@/lib/constants'
import { useAuth } from '@/hooks/useAuth'
import { useExpirySummary, daysLeftLabel } from '@/hooks/useExpiry'
import { PageHeader } from '@/components/common/PageHeader'
import { StatCard } from '@/components/common/StatCard'
import { EmptyState, ErrorState, FullPageLoader } from '@/components/common/States'
import { ImportStatusBadge } from '@/components/common/Badges'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { DashboardStats } from '@/types'

const C = { blue: '#1f6fd1', navy: '#0b2240', sky: '#8db8ec', grid: '#e4e9f0', axis: '#5a6b82' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

const tooltipStyle = { borderRadius: 8, border: '1px solid #dce3ec', fontSize: 12, boxShadow: '0 4px 14px rgb(15 30 51 / .08)' }


export default function DashboardPage() {
  const { profile, can } = useAuth()
  const [year, setYear] = useState('')
  const years = useQuery({ queryKey: ['archive_years'], queryFn: getArchiveYears })
  const stats = useQuery({
    queryKey: ['dashboard', year],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_dashboard_stats', { p_year: year ? Number(year) : null })
      if (error) throw error
      return data as DashboardStats
    },
  })

  const s = stats.data
  const expiry = useExpirySummary()
  const greeting = (() => {
    const h = new Date().getHours()
    return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam'
  })()

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${profile?.full_name?.split(' ')[0] || 'Pengguna'}`}
        description={year ? `Ringkasan arsip perizinan tahun ${year}.` : 'Ringkasan seluruh arsip perizinan yang tersimpan.'}
        actions={
          <>
            <NativeSelect aria-label="Filter tahun" className="w-40" value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">Semua tahun</option>
              {years.data?.map((y) => <option key={y} value={y}>{y}</option>)}
            </NativeSelect>
            {can('import.run') && <Button asChild><Link to="/impor"><FileUp /> Impor SiCANTIK</Link></Button>}
          </>
        }
      />

      {stats.isLoading && <FullPageLoader label="Menghitung statistik…" />}
      {stats.error && <Card><ErrorState error={stats.error} onRetry={() => stats.refetch()} /></Card>}

      {s && s.totals.applications === 0 && (
        <Card className="mb-6">
          <EmptyState
            title="Arsip masih kosong"
            description="Mulai dengan mengimpor file ekspor SiCANTIK (Excel/CSV) atau tambahkan data permohonan secara manual."
            action={can('import.run') ? <Button asChild><Link to="/impor">Impor data SiCANTIK</Link></Button>
              : <Button asChild variant="outline"><Link to="/permohonan">Buka data permohonan</Link></Button>}
          />
        </Card>
      )}

      {s && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Total arsip digital" value={formatNumber(s.totals.documents)} hint={`${formatBytes(s.totals.documents_size)} dokumen PDF`} icon={<FileStack className="size-4" />} to="/dokumen" />
            <StatCard label="Total permohonan" value={formatNumber(s.totals.applications)} hint={`${formatNumber(s.totals.applicants)} pemohon · ${formatNumber(s.totals.permit_types)} jenis izin`} icon={<ClipboardList className="size-4" />} to="/permohonan" />
            <StatCard label="Izin terbit" value={formatNumber(s.totals.permits)} hint={s.totals.applications ? `${Math.round((s.totals.permits / s.totals.applications) * 100)}% dari permohonan` : undefined} icon={<FileBadge2 className="size-4" />} to="/izin" />
            <StatCard label="Masih dalam proses" value={formatNumber(s.totals.in_process)} hint="Belum memiliki nomor izin" icon={<Hourglass className="size-4" />} to={`/pencarian?status=proses${year ? `&year=${year}` : ''}`} />
            <StatCard label="Dokumen belum lengkap" value={formatNumber(s.totals.incomplete)} hint="Berkas kurang dokumen wajib" icon={<AlertCircle className="size-4" />} tone="warning" to={`/pencarian?complete=no${year ? `&year=${year}` : ''}`} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>{year ? `Permohonan per bulan, ${year}` : 'Permohonan 12 bulan terakhir'}</CardTitle>
                <CardDescription>Jumlah permohonan masuk dan izin yang terbit, berdasarkan tanggal permohonan.</CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                {s.per_month.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={s.per_month.map((m) => ({ ...m, label: `${MONTHS[Number(m.month.slice(5)) - 1]} ${m.month.slice(2, 4)}` }))} margin={{ left: -16, right: 8, top: 8 }}>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: C.axis, fontSize: 12 }} tickLine={false} axisLine={{ stroke: C.grid }} />
                      <YAxis allowDecimals={false} tick={{ fill: C.axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                      <RTooltip contentStyle={tooltipStyle} />
                      <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="applications" name="Permohonan" stroke={C.blue} strokeWidth={2.5} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="permits" name="Izin terbit" stroke={C.navy} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <EmptyState title="Belum ada data pada periode ini" />}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Arsip per tahun</CardTitle>
                <CardDescription>Seluruh tahun yang tercatat.</CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                {s.per_year.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={s.per_year} margin={{ left: -16, right: 8, top: 8 }}>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      <XAxis dataKey="year" tick={{ fill: C.axis, fontSize: 12 }} tickLine={false} axisLine={{ stroke: C.grid }} />
                      <YAxis allowDecimals={false} tick={{ fill: C.axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                      <RTooltip contentStyle={tooltipStyle} cursor={{ fill: '#eef3fa' }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="applications" name="Permohonan" fill={C.blue} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="permits" name="Izin terbit" fill={C.navy} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="documents" name="Dokumen" fill={C.sky} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyState title="Belum ada data" />}
              </CardContent>
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Arsip per jenis izin</CardTitle>
                <CardDescription>12 jenis izin dengan permohonan terbanyak.</CardDescription>
              </CardHeader>
              <CardContent style={{ height: Math.max(220, s.per_permit_type.length * 30 + 30) }}>
                {s.per_permit_type.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={s.per_permit_type.map((p) => ({ ...p, short: shortPermitName(p.name, 38) }))} margin={{ left: 8, right: 24 }}>
                      <CartesianGrid stroke={C.grid} horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={{ fill: C.axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="short" width={230} tick={{ fill: '#0f1e33', fontSize: 12 }} tickLine={false} axisLine={false} />
                      <RTooltip contentStyle={tooltipStyle} cursor={{ fill: '#eef3fa' }} labelFormatter={(_, p) => p?.[0]?.payload?.name} />
                      <Bar dataKey="count" name="Permohonan" fill={C.blue} radius={[0, 3, 3, 0]} barSize={16} label={{ position: 'right', fill: C.axis, fontSize: 11 }} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyState title="Belum ada data" />}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Statistik sektor</CardTitle>
                <CardDescription>Sebaran permohonan menurut sektor jenis izin.</CardDescription>
              </CardHeader>
              <CardContent>
                <SectorBars data={s.per_sector} total={s.totals.applications} year={year} />
                {s.per_application_type.length > 0 && (
                  <div className="mt-5 border-t pt-4">
                    <p className="mb-2 text-sm font-semibold">Jenis permohonan</p>
                    <div className="grid grid-cols-2 gap-2">
                      {s.per_application_type.map((t) => (
                        <Link key={t.type} to={`/pencarian?applicationType=${encodeURIComponent(t.type)}${year ? `&year=${year}` : ''}`}
                          className="rounded-md border px-3 py-2 hover:border-primary/50">
                          <p className="text-xs text-muted-foreground">{t.type}</p>
                          <p className="text-lg font-bold tabular">{formatNumber(t.count)}</p>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className={expiry.data && expiry.data.buckets.some((b) => b.months <= 1 && b.count) ? 'border-[#f1c3bf]' : undefined}>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Izin akan berakhir</CardTitle>
                  <CardDescription>Belum diajukan perpanjangan.</CardDescription>
                </div>
                <Button asChild variant="link" size="sm"><Link to="/masa-berlaku">Semua</Link></Button>
              </CardHeader>
              <CardContent>
                {expiry.data ? (
                  <>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      {[...expiry.data.buckets].sort((a, b) => a.months - b.months).map((b) => (
                        <Link key={b.months} to={`/masa-berlaku?dalam=${b.months}`} className="rounded-md border px-1 py-2 hover:border-primary/50">
                          <p className={`text-xl font-bold tabular ${b.months <= 1 && b.count ? 'text-destructive' : ''}`}>{formatNumber(b.count)}</p>
                          <p className="text-[11px] text-muted-foreground">≤ {b.months} bulan</p>
                        </Link>
                      ))}
                      <Link to="/masa-berlaku?dalam=lewat" className="rounded-md border px-1 py-2 hover:border-primary/50">
                        <p className="text-xl font-bold tabular">{formatNumber(expiry.data.expired)}</p>
                        <p className="text-[11px] text-muted-foreground">Berakhir</p>
                      </Link>
                    </div>
                    <ul className="mt-3 space-y-1.5">
                      {expiry.data.nearest.slice(0, 3).map((n) => (
                        <li key={n.permit_id} className="flex justify-between gap-2 text-sm">
                          <Link to={`/permohonan/${n.application_id}`} className="truncate hover:text-primary">{n.applicant_name}</Link>
                          <span className="shrink-0 text-xs text-muted-foreground">{daysLeftLabel(n.days_left)}</span>
                        </li>
                      ))}
                    </ul>
                    {expiry.data.without_validity > 0 && (
                      <p className="mt-3 text-xs text-muted-foreground">{formatNumber(expiry.data.without_validity)} izin belum memiliki tanggal berakhir — isi masa berlaku di <Link className="text-primary hover:underline" to="/jenis-izin">jenis perizinan</Link>.</p>
                    )}
                  </>
                ) : <p className="py-6 text-center text-sm text-muted-foreground">Memuat…</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Impor terakhir</CardTitle>
                  <CardDescription>Lima proses impor SiCANTIK terbaru.</CardDescription>
                </div>
                <Button asChild variant="link" size="sm"><Link to="/impor/riwayat">Semua</Link></Button>
              </CardHeader>
              <CardContent>
                {s.recent_imports.length ? (
                  <ul className="divide-y">
                    {s.recent_imports.map((b) => (
                      <li key={b.id} className="py-2.5">
                        <Link to={`/impor/${b.id}`} className="block hover:text-primary">
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate text-sm font-medium">{b.file_name}</p>
                            <ImportStatusBadge status={b.status} />
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground tabular">
                            {formatDateTime(b.created_at)} · {formatNumber(b.inserted_count)} baru · {formatNumber(b.updated_count)} diperbarui · {formatNumber(b.failed_count)} gagal
                          </p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <p className="py-6 text-center text-sm text-muted-foreground">Belum ada proses impor.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Aktivitas pengguna</CardTitle>
                  <CardDescription>{can('audit.view') ? 'Sepuluh aktivitas terbaru.' : 'Aktivitas terbaru Anda.'}</CardDescription>
                </div>
                {can('audit.view') && <Button asChild variant="link" size="sm"><Link to="/audit">Audit trail</Link></Button>}
              </CardHeader>
              <CardContent>
                {s.recent_activity.length ? (
                  <ol className="relative space-y-3 border-l pl-4">
                    {s.recent_activity.map((a) => (
                      <li key={a.id} className="relative">
                        <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-card bg-primary" />
                        <p className="text-sm">
                          <span className="font-medium">{a.user_name || a.user_email || 'Sistem'}</span>{' '}
                          <span className="text-muted-foreground">
                            {['insert', 'update', 'delete'].includes(a.action)
                              ? `${(ACTIVITY_LABELS[a.action] ?? a.action).toLowerCase()} ${a.entity_type ? (ENTITY_LABELS[a.entity_type] ?? a.entity_type).toLowerCase() : ''}`
                              : (a.description ?? ACTIVITY_LABELS[a.action] ?? a.action)}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground" title={formatDateTime(a.created_at)}>{formatRelative(a.created_at)}</p>
                      </li>
                    ))}
                  </ol>
                ) : <p className="py-6 text-center text-sm text-muted-foreground">Belum ada aktivitas.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Dokumen per kategori</CardTitle>
                <CardDescription>Versi terakhir setiap dokumen.</CardDescription>
              </CardHeader>
              <CardContent>
                {s.per_category.length ? (
                  <ul className="space-y-2">
                    {s.per_category.map((c) => (
                      <li key={c.category} className="flex items-center justify-between text-sm">
                        <Link className="hover:text-primary" to={`/dokumen?category=${c.category}`}>{categoryLabel(c.category)}</Link>
                        <span className="font-semibold tabular">{formatNumber(c.count)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Belum ada dokumen PDF. Unggah dari halaman detail permohonan.
                  </p>
                )}
                <p className="mt-4 text-xs text-muted-foreground">Data per {formatDate(new Date().toISOString(), 'd MMMM yyyy, HH.mm')}</p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function SectorBars({ data, total, year }: { data: DashboardStats['per_sector']; total: number; year: string }) {
  if (!data.length) return <p className="py-6 text-center text-sm text-muted-foreground">Belum ada data.</p>
  const max = Math.max(...data.map((d) => d.count))
  return (
    <ul className="space-y-3">
      {data.map((d) => (
        <li key={d.sector}>
          <Link to={`/pencarian?sector=${encodeURIComponent(d.sector)}${year ? `&year=${year}` : ''}`} className="group block">
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="font-medium group-hover:text-primary">{d.sector}</span>
              <span className="tabular text-muted-foreground">
                <span className="font-semibold text-foreground">{formatNumber(d.count)}</span> · {total ? Math.round((d.count / total) * 100) : 0}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div className="h-2 rounded-full bg-primary" style={{ width: `${(d.count / max) * 100}%` }} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
