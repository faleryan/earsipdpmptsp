import { PageHeader } from '@/components/common/PageHeader'
import { ArchiveListView } from '@/components/archive/ArchiveListView'

export default function SearchPage() {
  return (
    <div>
      <PageHeader
        title="Pencarian arsip"
        description="Gabungkan kata kunci dengan filter tanggal, jenis izin, sektor, klasifikasi, status izin, dan kelengkapan dokumen. Alamat halaman menyimpan filter sehingga hasil dapat dibagikan."
      />
      <ArchiveListView queryKey="search" variant="advanced" exportTitle="Hasil Pencarian Arsip Perizinan" />
    </div>
  )
}
