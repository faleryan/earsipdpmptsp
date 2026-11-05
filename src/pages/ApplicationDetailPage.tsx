import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft, Download, Eye, FilePlus2, FileText, History, MoreHorizontal, Pencil, PencilLine, RotateCcw, Trash2, Upload,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { formatBytes, formatDate, formatDateTime, maskNik } from '@/lib/format'
import { ACTIVITY_LABELS, DOCUMENT_CATEGORIES, ENTITY_LABELS, FINAL_DISPOSITION, categoryLabel } from '@/lib/constants'
import { useAuth } from '@/hooks/useAuth'
import { useSettings } from '@/hooks/useSettings'
import { PageHeader } from '@/components/common/PageHeader'
import { ApplicationStatusBadge, AccessBadge, PermitStatusBadge, SourceBadge } from '@/components/common/Badges'
import { DocumentTabs } from '@/components/common/DocumentTabs'
import { ErrorState, FullPageLoader } from '@/components/common/States'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ApplicationFormDialog } from '@/components/archive/ApplicationFormDialog'
import { PermitFormDialog } from '@/components/archive/PermitFormDialog'
import { UploadDocumentsDialog } from '@/components/documents/UploadDocumentsDialog'
import { PdfPreviewDialog, downloadDocument, useCanDownload } from '@/components/documents/PdfPreviewDialog'
import { DocumentEditDialog, DocumentVersionsDialog } from '@/components/documents/DocumentDialogs'
import type { ActivityLog, Application, ArchiveDocument, ArchiveRow, Classification, DocumentCategory, Permit } from '@/types'

const SOURCE_LABELS: Record<string, string> = {
  source_id: 'ID SiCANTIK', application_number: 'No. permohonan', permit_type_name: 'Jenis izin', application_type: 'Jenis',
  application_date: 'Tanggal', applicant_name: 'Pemohon', applicant_nik: 'NIK', applicant_phone: 'Telepon', applicant_email: 'Email',
  applicant_address: 'Alamat', location: 'Lokasi', permit_location: 'Lokasi izin', permit_number: 'Nomor izin',
  issued_date: 'Tanggal penetapan', valid_until: 'Berlaku sampai', company_name: 'Badan usaha', company_form: 'Bentuk usaha',
  company_nib: 'NIB', company_npwp: 'NPWP', company_address: 'Alamat usaha', sector: 'Sektor',
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children ?? '—'}</dd>
    </div>
  )
}

type DocRow = ArchiveDocument & { uploader: { full_name: string } | null }

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { can, profile } = useAuth()
  const { data: settings } = useSettings()
  const canDownload = useCanDownload()
  const [showDeleted, setShowDeleted] = useState(false)
  const [editing, setEditing] = useState(false)
  const [permitOpen, setPermitOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState<{ category?: DocumentCategory; versionOf?: ArchiveDocument } | null>(null)
  const [preview, setPreview] = useState<ArchiveDocument | null>(null)
  const [versions, setVersions] = useState<ArchiveDocument | null>(null)
  const [editDoc, setEditDoc] = useState<ArchiveDocument | null>(null)
  const [deleteDoc, setDeleteDoc] = useState<ArchiveDocument | null>(null)
  const [deleteApp, setDeleteApp] = useState(false)

  const detail = useQuery({
    queryKey: ['application', id],
    enabled: !!id,
    queryFn: async () => {
      const [row, app, permit] = await Promise.all([
        supabase.from('v_archive_list').select('*').eq('id', id!).maybeSingle(),
        supabase.from('applications').select('*, classification:classifications(*)').eq('id', id!).maybeSingle(),
        supabase.from('permits').select('*').eq('application_id', id!).maybeSingle(),
      ])
      if (row.error) throw row.error
      if (app.error) throw app.error
      if (permit.error) throw permit.error
      return {
        row: row.data as ArchiveRow | null,
        app: app.data as (Application & { classification: Classification | null }) | null,
        permit: permit.data as Permit | null,
      }
    },
  })

  const docs = useQuery({
    queryKey: ['documents', 'application', id, showDeleted],
    enabled: !!id,
    queryFn: async () => {
      let q = supabase.from('archive_documents')
        .select('*, uploader:profiles!archive_documents_uploaded_by_fkey(full_name)')
        .eq('application_id', id!).eq('is_latest', true).order('created_at')
      if (!showDeleted) q = q.is('deleted_at', null)
      const { data, error } = await q
      if (error) throw error
      return data as DocRow[]
    },
  })

  const history = useQuery({
    queryKey: ['application', id, 'history'],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('activity_logs').select('*')
        .or(`entity_id.eq.${id},new_data->>application_id.eq.${id},old_data->>application_id.eq.${id}`)
        .order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      return data as ActivityLog[]
    },
  })

  const grouped = useMemo(() => {
    const map = new Map<DocumentCategory, DocRow[]>()
    docs.data?.forEach((d) => map.set(d.category, [...(map.get(d.category) ?? []), d]))
    return map
  }, [docs.data])

  if (detail.isLoading) return <FullPageLoader />
  if (detail.error) return <Card><ErrorState error={detail.error} onRetry={() => detail.refetch()} /></Card>
  const { row, app, permit } = detail.data ?? {}
  if (!row || !app) {
    return (
      <Card><ErrorState error="Arsip tidak ditemukan, sudah dihapus, atau Anda tidak memiliki akses." /></Card>
    )
  }

  const canEdit = can('archive.edit_all') || (can('archive.write') && app.created_by === profile?.id)
  const canUpload = can('documents.upload')
  const reveal = can('pii.view')
  const ttl = settings?.signedUrlTtl ?? 300
  const canManageDoc = (d: ArchiveDocument) => can('documents.manage') || (can('documents.upload') && d.uploaded_by === profile?.id)
  const manualFields = new Set(app.manually_edited_fields ?? [])

  return (
    <div>
      <Link to="/permohonan" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Data permohonan
      </Link>
      <PageHeader
        title={row.application_number}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{row.permit_type_name}</span>
            <ApplicationStatusBadge status={row.status} />
            <SourceBadge source={row.data_source} manual={row.is_manually_edited} />
            <AccessBadge level={row.access_level} />
          </span>
        }
        actions={
          <>
            {canUpload && <Button onClick={() => setUploadOpen({})}><Upload /> Unggah dokumen</Button>}
            {canEdit && <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> Ubah</Button>}
            {can('archive.delete') && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="Aksi lain"><MoreHorizontal /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteApp(true)}><Trash2 /> Hapus permohonan</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          {/* Kelengkapan berkas */}
          <Card>
            <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">Kelengkapan berkas</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {row.is_complete
                    ? 'Seluruh dokumen wajib sudah tersedia.'
                    : `Kurang: ${row.missing_documents.map(categoryLabel).join(', ')}.`}
                </p>
              </div>
              <DocumentTabs required={row.required_documents} present={row.document_categories} size="md" showLabels />
            </CardContent>
          </Card>

          <Tabs defaultValue="dokumen">
            <TabsList>
              <TabsTrigger value="dokumen"><FileText className="size-4" /> Dokumen ({docs.data?.filter((d) => !d.deleted_at).length ?? 0})</TabsTrigger>
              <TabsTrigger value="sumber">Data SiCANTIK</TabsTrigger>
              <TabsTrigger value="riwayat"><History className="size-4" /> Riwayat</TabsTrigger>
            </TabsList>

            <TabsContent value="dokumen">
              <Card>
                {can('documents.manage') && (
                  <label className="flex items-center justify-end gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
                    <Switch checked={showDeleted} onCheckedChange={setShowDeleted} /> Tampilkan dokumen yang dihapus
                  </label>
                )}
                {docs.error ? <ErrorState error={docs.error} onRetry={() => docs.refetch()} /> : (
                  <ul className="divide-y">
                    {DOCUMENT_CATEGORIES.map((cat) => {
                      const items = grouped.get(cat.value) ?? []
                      const required = row.required_documents.includes(cat.value)
                      if (!items.length && !required) return null
                      return (
                        <li key={cat.value} className="px-4 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold">
                              {cat.label} {required && <span className="ml-1 text-xs font-normal text-muted-foreground">wajib</span>}
                            </p>
                            {canUpload && (
                              <Button variant="ghost" size="sm" onClick={() => setUploadOpen({ category: cat.value })}><FilePlus2 /> Tambah</Button>
                            )}
                          </div>
                          {!items.length ? (
                            <p className="mt-1 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">Belum ada dokumen.</p>
                          ) : (
                            <ul className="mt-2 space-y-2">
                              {items.map((d) => (
                                <li key={d.id} className={`flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 ${d.deleted_at ? 'opacity-60' : ''}`}>
                                  <FileText className="size-5 shrink-0 text-primary" />
                                  <button className="min-w-0 flex-1 text-left" onClick={() => setPreview(d)}>
                                    <p className="truncate text-sm font-medium hover:text-primary">
                                      {d.title} <span className="font-normal text-muted-foreground">v{d.version}</span>
                                    </p>
                                    <p className="truncate text-xs text-muted-foreground">
                                      {[d.document_number && `No. ${d.document_number}`, d.document_date && formatDate(d.document_date),
                                        formatBytes(d.file_size), d.page_count && `${d.page_count} hlm`, d.uploader?.full_name, formatDateTime(d.created_at)]
                                        .filter(Boolean).join(' · ')}
                                    </p>
                                  </button>
                                  <AccessBadge level={d.access_level} />
                                  {d.deleted_at && <Badge variant="danger">Dihapus</Badge>}
                                  <div className="flex items-center">
                                    <Button variant="ghost" size="icon-sm" aria-label="Pratinjau" onClick={() => setPreview(d)}><Eye /></Button>
                                    {canDownload && <Button variant="ghost" size="icon-sm" aria-label="Unduh" onClick={() => downloadDocument(d, ttl)}><Download /></Button>}
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Aksi dokumen"><MoreHorizontal /></Button></DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onSelect={() => setVersions(d)}><History /> Riwayat versi</DropdownMenuItem>
                                        {canManageDoc(d) && !d.deleted_at && (
                                          <>
                                            <DropdownMenuItem onSelect={() => setUploadOpen({ versionOf: d })}><Upload /> Unggah versi baru</DropdownMenuItem>
                                            <DropdownMenuItem onSelect={() => setEditDoc(d)}><PencilLine /> Ubah metadata</DropdownMenuItem>
                                          </>
                                        )}
                                        {can('documents.manage') && (
                                          <>
                                            <DropdownMenuSeparator />
                                            {d.deleted_at ? (
                                              <DropdownMenuItem onSelect={async () => {
                                                const { error } = await supabase.from('archive_documents').update({ deleted_at: null }).eq('document_group_id', d.document_group_id)
                                                if (error) toast.error(errorMessage(error))
                                                else { toast.success('Dokumen dipulihkan.'); qc.invalidateQueries({ queryKey: ['documents'] }); qc.invalidateQueries({ queryKey: ['application'] }) }
                                              }}><RotateCcw /> Pulihkan</DropdownMenuItem>
                                            ) : (
                                              <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteDoc(d)}><Trash2 /> Hapus</DropdownMenuItem>
                                            )}
                                          </>
                                        )}
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Card>
            </TabsContent>

            <TabsContent value="sumber">
              <Card>
                <CardContent className="pt-5">
                  {app.source_data ? (
                    <>
                      <p className="mb-3 text-sm text-muted-foreground">
                        Nilai terakhir yang diterima dari impor SiCANTIK. {app.is_manually_edited && 'Kolom bertanda telah diubah manual di E-Arsip dan dilindungi dari penimpaan impor.'}
                      </p>
                      <dl className="divide-y">
                        {Object.entries(app.source_data).filter(([, v]) => v !== null && v !== '').map(([k, v]) => (
                          <Info key={k} label={SOURCE_LABELS[k] ?? k}>
                            <span className="inline-flex items-center gap-2">
                              {k === 'applicant_nik' ? maskNik(String(v), reveal) : String(v)}
                              {manualFields.has(k) && <Badge variant="warning">Diubah manual</Badge>}
                            </span>
                          </Info>
                        ))}
                      </dl>
                    </>
                  ) : <p className="py-6 text-center text-sm text-muted-foreground">Arsip ini diinput manual, tidak berasal dari impor SiCANTIK.</p>}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="riwayat">
              <Card>
                <CardContent className="pt-5">
                  {history.error ? <ErrorState error={history.error} /> : !history.data?.length ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">Belum ada riwayat yang dapat Anda lihat. Data hasil impor massal dicatat per batch di Riwayat impor.</p>
                  ) : (
                    <ol className="relative space-y-4 border-l pl-5">
                      {history.data.map((h) => (
                        <li key={h.id} className="relative">
                          <span className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-card bg-primary" />
                          <p className="text-sm">
                            <span className="font-medium">{h.user_email ?? 'Sistem'}</span>{' '}
                            {(ACTIVITY_LABELS[h.action] ?? h.action).toLowerCase()} {(ENTITY_LABELS[h.entity_type ?? ''] ?? h.entity_type ?? '').toLowerCase()}
                          </p>
                          <p className="text-xs text-muted-foreground">{formatDateTime(h.created_at)}</p>
                          {h.action === 'update' && h.new_data && (
                            <ul className="mt-1 space-y-0.5 text-xs">
                              {Object.keys(h.new_data).filter((k) => !['manually_edited_at', 'manually_edited_fields', 'is_manually_edited', 'manually_edited_by'].includes(k)).slice(0, 8).map((k) => (
                                <li key={k} className="text-muted-foreground">
                                  <span className="font-medium text-foreground">{k}</span>: {String(h.old_data?.[k] ?? '—')} → {String(h.new_data?.[k] ?? '—')}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Permohonan</CardTitle></CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Info label="ID SiCANTIK">{row.source_id && <span className="tabular">{row.source_id}</span>}</Info>
                <Info label="Tanggal">{formatDate(row.application_date, 'd MMMM yyyy')}</Info>
                <Info label="Jenis permohonan">{row.application_type}</Info>
                <Info label="Jenis izin">{row.permit_type_name}</Info>
                <Info label="Sektor">{row.sector}</Info>
                <Info label="Lokasi">{row.location}</Info>
                <Info label="Lokasi izin">{row.permit_location}</Info>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Pemohon</CardTitle></CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Info label="Nama"><Link className="font-medium text-primary hover:underline" to={`/pencarian?applicantId=${row.applicant_id}`}>{row.applicant_name}</Link></Info>
                <Info label="NIK"><span className="tabular">{maskNik(row.applicant_nik, reveal)}</span></Info>
                <Info label="Telepon">{row.applicant_phone}</Info>
                <Info label="Email">{row.applicant_email}</Info>
                {row.company_name && <Info label="Badan usaha"><Link className="text-primary hover:underline" to={`/pencarian?companyId=${row.company_id}`}>{row.company_name}</Link></Info>}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Izin terbit</CardTitle>
              {canEdit && <Button size="sm" variant="outline" onClick={() => setPermitOpen(true)}>{permit ? 'Ubah' : 'Catat izin'}</Button>}
            </CardHeader>
            <CardContent>
              {permit ? (
                <dl className="divide-y">
                  <Info label="Nomor izin"><span className="font-medium">{permit.permit_number}</span></Info>
                  <Info label="Tanggal penetapan">{formatDate(permit.issued_date, 'd MMMM yyyy')}</Info>
                  <Info label="Berlaku sampai">{permit.valid_until ? formatDate(permit.valid_until, 'd MMMM yyyy') : 'Tidak ditentukan'}</Info>
                  <Info label="Status"><PermitStatusBadge status={permit.status} /></Info>
                  {permit.signed_by && <Info label="Penandatangan">{permit.signed_by}</Info>}
                  {permit.notes && <Info label="Catatan">{permit.notes}</Info>}
                </dl>
              ) : <p className="text-sm text-muted-foreground">Belum ada nomor izin untuk permohonan ini.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Metadata arsip</CardTitle></CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Info label="Klasifikasi">{app.classification ? `${app.classification.code} — ${app.classification.name}` : <span className="text-warning">Belum diklasifikasikan</span>}</Info>
                {app.classification && (
                  <Info label="Retensi">
                    {app.classification.retention_active_years} th aktif, {app.classification.retention_inactive_years} th inaktif · {FINAL_DISPOSITION[app.classification.final_disposition]}
                  </Info>
                )}
                <Info label="Kode arsip">{app.archive_code}</Info>
                <Info label="Lokasi fisik">{app.physical_location}</Info>
                <Info label="Tingkat akses"><span className="capitalize">{app.access_level}</span></Info>
                <Info label="Catatan">{app.notes}</Info>
                <Info label="Diperbarui">{formatDateTime(app.updated_at)}</Info>
                {app.last_import_batch_id && <Info label="Impor terakhir"><Link className="text-primary hover:underline" to={`/impor/${app.last_import_batch_id}`}>Lihat batch</Link></Info>}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      <ApplicationFormDialog open={editing} onOpenChange={setEditing} application={app} />
      <PermitFormDialog open={permitOpen} onOpenChange={setPermitOpen} applicationId={app.id} permit={permit} applicationStatus={app.status} />
      {uploadOpen && (
        <UploadDocumentsDialog
          open
          onOpenChange={(o) => !o && setUploadOpen(null)}
          applicationId={app.id}
          applicationNumber={app.application_number}
          permitId={permit?.id}
          defaultAccess={app.access_level === 'rahasia' && !can('documents.secret') ? 'terbatas' : app.access_level}
          defaultCategory={uploadOpen.category}
          versionOf={uploadOpen.versionOf}
        />
      )}
      <PdfPreviewDialog doc={preview} onOpenChange={(o) => !o && setPreview(null)} />
      <DocumentVersionsDialog doc={versions} onOpenChange={(o) => !o && setVersions(null)} onPreview={(d) => setPreview(d)} />
      <DocumentEditDialog doc={editDoc} onOpenChange={(o) => !o && setEditDoc(null)} />
      <ConfirmDialog
        open={!!deleteDoc} onOpenChange={(o) => !o && setDeleteDoc(null)}
        title="Hapus dokumen?"
        description={<>Dokumen <strong>{deleteDoc?.title}</strong> dipindahkan ke daftar terhapus dan tidak lagi dihitung dalam kelengkapan. File tetap tersimpan dan dapat dipulihkan Admin.</>}
        confirmLabel="Hapus dokumen" destructive
        onConfirm={async () => {
          const { error } = await supabase.from('archive_documents').update({ deleted_at: new Date().toISOString() }).eq('document_group_id', deleteDoc!.document_group_id).is('deleted_at', null)
          if (error) { toast.error(errorMessage(error)); throw error }
          toast.success('Dokumen dihapus.')
          qc.invalidateQueries({ queryKey: ['documents'] })
          qc.invalidateQueries({ queryKey: ['application'] })
        }}
      />
      <ConfirmDialog
        open={deleteApp} onOpenChange={setDeleteApp}
        title="Hapus permohonan?"
        description={<>Permohonan <strong>{app.application_number}</strong> beserta data izinnya akan dihapus permanen. Permohonan yang masih memiliki dokumen tidak dapat dihapus — hapus dokumennya terlebih dahulu. Jika berasal dari SiCANTIK, data akan muncul kembali pada impor berikutnya.</>}
        confirmLabel="Hapus permanen" destructive
        onConfirm={async () => {
          const { count } = await supabase.from('archive_documents').select('id', { count: 'exact', head: true }).eq('application_id', app.id)
          if (count) { toast.error(`Masih ada ${count} dokumen (termasuk yang dihapus/versi lama). Super Admin harus menghapusnya permanen terlebih dahulu.`); throw new Error('has docs') }
          const { error } = await supabase.from('applications').delete().eq('id', app.id)
          if (error) { toast.error(errorMessage(error)); throw error }
          toast.success('Permohonan dihapus.')
          qc.invalidateQueries({ queryKey: ['archive'] })
          navigate('/permohonan')
        }}
      />
    </div>
  )
}
