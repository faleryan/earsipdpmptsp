import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/common/PageHeader'
import { ArchiveListView } from '@/components/archive/ArchiveListView'
import { PermitStatusBadge } from '@/components/common/Badges'
import { DocumentTabs } from '@/components/common/DocumentTabs'
import { EmptyState } from '@/components/common/States'
import { formatDate } from '@/lib/format'
import type { Column } from '@/components/common/DataTable'
import type { ArchiveRow } from '@/types'

const columns = (): Column<ArchiveRow>[] => [
  {
    key: 'permit_number', header: 'Nomor izin', sortable: true,
    cell: (r) => (
      <div className="min-w-60">
        <Link to={`/permohonan/${r.id}`} className="font-semibold hover:text-primary hover:underline">{r.permit_number}</Link>
        <p className="text-xs text-muted-foreground">Permohonan {r.application_number}</p>
      </div>
    ),
  },
  { key: 'issued_date', header: 'Tanggal penetapan', sortable: true, cell: (r) => <span className="whitespace-nowrap tabular">{formatDate(r.issued_date)}</span> },
  { key: 'valid_until', header: 'Berlaku sampai', sortable: true, cell: (r) => <span className="whitespace-nowrap tabular">{formatDate(r.valid_until)}</span> },
  { key: 'permit_type_name', header: 'Jenis izin', sortable: true, cell: (r) => <div className="min-w-56 max-w-80"><p className="line-clamp-2">{r.permit_type_name}</p><p className="text-xs text-muted-foreground">{r.application_type}</p></div> },
  { key: 'applicant_name', header: 'Pemegang izin', sortable: true, cell: (r) => <div className="min-w-44"><p className="font-medium">{r.company_name ?? r.applicant_name}</p>{r.company_name && <p className="text-xs text-muted-foreground">{r.applicant_name}</p>}</div> },
  { key: 'permit_location', header: 'Lokasi izin', cell: (r) => <span className="line-clamp-2 min-w-40 text-sm">{r.permit_location ?? r.location ?? '—'}</span> },
  { key: 'permit_status', header: 'Status', cell: (r) => <PermitStatusBadge status={r.permit_status} /> },
  { key: 'docs', header: 'Berkas', cell: (r) => <DocumentTabs required={r.required_documents} present={r.document_categories} /> },
]

export default function PermitsPage() {
  return (
    <div>
      <PageHeader title="Izin terbit" description="Permohonan yang sudah memiliki nomor izin / surat keputusan." />
      <ArchiveListView
        queryKey="permits"
        fixed={{ hasPermit: 'yes' }}
        hideFilters={['hasPermit', 'status']}
        defaultSort={{ column: 'issued_date', ascending: false }}
        columns={columns}
        exportTitle="Daftar Izin Terbit"
        emptyState={<EmptyState title="Belum ada izin terbit" description="Izin tercatat otomatis dari kolom Nomor Izin saat impor SiCANTIK, atau dari halaman detail permohonan." />}
      />
    </div>
  )
}
