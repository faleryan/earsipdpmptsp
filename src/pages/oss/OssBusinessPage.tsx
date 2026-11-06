import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Building2, FileCheck2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatDate, formatNumber, formatRupiah } from '@/lib/format'
import { PageHeader } from '@/components/common/PageHeader'
import { ErrorState, FullPageLoader } from '@/components/common/States'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { OssDocumentsPanel } from '@/components/oss/OssDocumentsPanel'
import { OssStatusBadge, RiskBadge } from './OssPage'
import type { OssBusinessRow, OssPermitRow, OssProjectRow } from '@/types'

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children || '—'}</dd>
    </div>
  )
}

export default function OssBusinessPage() {
  const { nib } = useParams<{ nib: string }>()
  const q = useQuery({
    queryKey: ['oss', 'nib', nib],
    queryFn: async () => {
      const [b, pj, pm, co] = await Promise.all([
        supabase.from('v_oss_business').select('*').eq('nib', nib!).maybeSingle(),
        supabase.from('oss_projects').select('*').eq('nib', nib!).order('submitted_date', { ascending: false }),
        supabase.from('v_oss_permit').select('*').eq('nib', nib!).order('permit_date', { ascending: false }),
        supabase.from('companies').select('id, name').eq('nib', nib!).maybeSingle(),
      ])
      if (b.error) throw b.error
      if (pj.error) throw pj.error
      if (pm.error) throw pm.error
      return { business: b.data as OssBusinessRow | null, projects: pj.data as OssProjectRow[], permits: pm.data as OssPermitRow[], company: co.data as { id: string; name: string } | null }
    },
  })
  if (q.isLoading) return <FullPageLoader />
  if (q.error) return <Card><ErrorState error={q.error} /></Card>
  const { business: b, projects, permits, company } = q.data!
  if (!b) return <Card><ErrorState error="NIB tidak ditemukan di data OSS." /></Card>

  return (
    <div>
      <Link to="/oss?tab=pelaku" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Data OSS</Link>
      <PageHeader
        title={b.name}
        description={<span className="flex flex-wrap items-center gap-2"><span className="tabular">NIB {b.nib}</span>{b.has_nib_document && <Badge variant="success"><FileCheck2 className="mr-1 size-3" />File NIB tersimpan</Badge>}{b.business_scale && <Badge variant="outline">{b.business_scale}</Badge>}{b.investment_status && <Badge variant="muted">{b.investment_status}</Badge>}</span>}
      />
      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Profil pelaku usaha</CardTitle></CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Info label="NIB terbit">{formatDate(b.oss_issued_date, 'd MMMM yyyy')}</Info>
                <Info label="Jenis">{b.company_type}</Info>
                <Info label="Alamat">{b.address}</Info>
                <Info label="Kelurahan / desa">{b.kelurahan}</Info>
                <Info label="Kecamatan">{b.kecamatan}</Info>
                <Info label="Proyek">{formatNumber(b.project_count)}</Info>
                <Info label="Izin OSS">{formatNumber(b.permit_count)}</Info>
                <Info label="Rencana investasi">{formatRupiah(b.investment)}</Info>
                <Info label="Tenaga kerja">{formatNumber(b.workers)}</Info>
              </dl>
              {!b.has_nib_record && <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Profil NIB lengkap belum ada di ekspor DP.NIB yang diimpor; data diambil dari ekspor proyek/izin.</p>}
            </CardContent>
          </Card>
          {company && (
            <Card>
              <CardContent className="flex items-center gap-3 pt-5 text-sm">
                <Building2 className="size-5 text-primary" />
                <span>Tercatat juga sebagai badan usaha E-Arsip: <Link className="text-primary hover:underline" to={`/pencarian?companyId=${company.id}`}>{company.name}</Link></span>
              </CardContent>
            </Card>
          )}
        </div>
        <div className="min-w-0 space-y-4">
          <OssDocumentsPanel nib={b.nib} companyName={b.name} permits={permits} />
          <Card>
            <CardHeader><CardTitle>Proyek ({projects.length})</CardTitle></CardHeader>
            {projects.length ? (
              <Table>
                <TableHeader><TableRow><TableHead>Proyek</TableHead><TableHead>KBLI</TableHead><TableHead>Risiko</TableHead><TableHead className="text-right">Investasi</TableHead><TableHead className="text-right">TKI</TableHead><TableHead>Lokasi</TableHead></TableRow></TableHeader>
                <TableBody>
                  {projects.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="min-w-48"><p className="font-medium">{p.project_name ?? '—'}</p><p className="text-xs text-muted-foreground tabular">{p.project_id} · {formatDate(p.submitted_date)}</p></TableCell>
                      <TableCell className="min-w-56"><p className="tabular">{p.kbli}</p><p className="line-clamp-2 text-xs text-muted-foreground">{p.kbli_title}</p></TableCell>
                      <TableCell><RiskBadge value={p.risk_level} /></TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular">{formatRupiah(p.investment)}</TableCell>
                      <TableCell className="text-right tabular">{p.workers ?? '—'}</TableCell>
                      <TableCell className="min-w-32 text-sm">{p.kelurahan}<p className="text-xs text-muted-foreground">{p.kecamatan}</p></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : <p className="px-5 pb-5 text-sm text-muted-foreground">Belum ada data proyek untuk NIB ini (impor ekspor DP.Proyek).</p>}
          </Card>
          <Card>
            <CardHeader><CardTitle>Izin OSS ({permits.length})</CardTitle></CardHeader>
            {permits.length ? (
              <Table>
                <TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead>Dokumen</TableHead><TableHead>Proyek</TableHead><TableHead>Risiko</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Dokumen</TableHead></TableRow></TableHeader>
                <TableBody>
                  {permits.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap tabular">{formatDate(p.permit_date)}</TableCell>
                      <TableCell className="min-w-52"><p className="font-medium">{p.document_name}</p><p className="text-xs text-muted-foreground">{p.permit_category} · <span className="tabular">{p.permit_request_id}</span></p></TableCell>
                      <TableCell className="min-w-44 text-sm">{p.project_name ?? '—'}<p className="text-xs text-muted-foreground tabular">{p.kbli}</p></TableCell>
                      <TableCell><RiskBadge value={p.risk_code} /></TableCell>
                      <TableCell><OssStatusBadge value={p.permit_status} /></TableCell>
                      <TableCell className="text-right tabular">{p.document_count ? <Badge variant="default">{p.document_count} PDF</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : <p className="px-5 pb-5 text-sm text-muted-foreground">Belum ada data izin untuk NIB ini (impor ekspor List izin).</p>}
          </Card>
        </div>
      </div>
    </div>
  )
}
