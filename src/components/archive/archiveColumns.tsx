import { Link } from 'react-router-dom'
import type { Column } from '@/components/common/DataTable'
import { ApplicationStatusBadge, AccessBadge, PermitStatusBadge, SourceBadge } from '@/components/common/Badges'
import { DocumentTabs } from '@/components/common/DocumentTabs'
import { formatDate, maskNik } from '@/lib/format'
import type { ArchiveRow } from '@/types'

export function archiveColumns(opts: { revealNik: boolean; withPermit?: boolean; withSource?: boolean }): Column<ArchiveRow>[] {
  const cols: Column<ArchiveRow>[] = [
    {
      key: 'application_number', header: 'Nomor permohonan', sortable: true,
      cell: (r) => (
        <div className="min-w-56">
          <Link to={`/permohonan/${r.id}`} className="font-semibold text-foreground hover:text-primary hover:underline">{r.application_number}</Link>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {r.source_id ? <span className="tabular">ID {r.source_id}</span> : <span>Tanpa ID SiCANTIK</span>}
            <AccessBadge level={r.access_level} />
          </p>
        </div>
      ),
    },
    { key: 'application_date', header: 'Tanggal', sortable: true, cell: (r) => <span className="whitespace-nowrap tabular">{formatDate(r.application_date)}</span> },
    {
      key: 'permit_type_name', header: 'Jenis izin', sortable: true,
      cell: (r) => <div className="min-w-56 max-w-80"><p className="line-clamp-2">{r.permit_type_name}</p><p className="text-xs text-muted-foreground">{r.application_type} · {r.sector}</p></div>,
    },
    {
      key: 'applicant_name', header: 'Pemohon', sortable: true,
      cell: (r) => <div className="min-w-44"><p className="font-medium">{r.applicant_name}</p><p className="text-xs text-muted-foreground tabular">{maskNik(r.applicant_nik, opts.revealNik)}</p></div>,
    },
  ]
  if (opts.withPermit !== false) {
    cols.push({
      key: 'permit_number', header: 'Izin terbit', sortable: true,
      cell: (r) => r.permit_number ? (
        <div className="min-w-48"><p className="text-sm">{r.permit_number}</p><p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">{formatDate(r.issued_date)} <PermitStatusBadge status={r.permit_status} /></p></div>
      ) : <ApplicationStatusBadge status={r.status} />,
    })
  }
  cols.push({ key: 'docs', header: 'Berkas', cell: (r) => <div className="flex items-center gap-2"><DocumentTabs required={r.required_documents} present={r.document_categories} /><span className="text-xs text-muted-foreground tabular">{r.document_count}</span></div> })
  if (opts.withSource) cols.push({ key: 'data_source', header: 'Sumber', cell: (r) => <SourceBadge source={r.data_source} manual={r.is_manually_edited} /> })
  return cols
}
