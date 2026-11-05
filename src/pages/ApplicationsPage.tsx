import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FileUp, Plus } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { ArchiveListView } from '@/components/archive/ArchiveListView'
import { ApplicationFormDialog } from '@/components/archive/ApplicationFormDialog'

export default function ApplicationsPage() {
  const { can } = useAuth()
  const [creating, setCreating] = useState(false)
  return (
    <div>
      <PageHeader
        title="Data permohonan"
        description="Setiap permohonan adalah satu berkas arsip: data dari SiCANTIK, izin yang terbit, dan dokumen PDF-nya."
        actions={
          <>
            {can('import.run') && <Button variant="outline" asChild><Link to="/impor"><FileUp /> Impor SiCANTIK</Link></Button>}
            {can('archive.write') && <Button onClick={() => setCreating(true)}><Plus /> Tambah permohonan</Button>}
          </>
        }
      />
      <ArchiveListView
        queryKey="applications"
        exportTitle="Daftar Permohonan Izin"
        emptyState={
          <EmptyState
            title="Belum ada permohonan"
            description="Impor file ekspor SiCANTIK atau tambahkan permohonan secara manual."
            action={can('import.run') ? <Button asChild><Link to="/impor">Impor SiCANTIK</Link></Button> : undefined}
          />
        }
      />
      <ApplicationFormDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}
