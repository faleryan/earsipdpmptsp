import { PencilLine } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/misc'
import { APPLICATION_STATUS, IMPORT_STATUS, PERMIT_STATUS, accessLabel } from '@/lib/constants'

export function ApplicationStatusBadge({ status }: { status: string }) {
  const s = APPLICATION_STATUS[status] ?? { label: status, variant: 'muted' as const }
  return <Badge variant={s.variant}>{s.label}</Badge>
}
export function PermitStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>
  const s = PERMIT_STATUS[status] ?? { label: status, variant: 'muted' as const }
  return <Badge variant={s.variant}>{s.label}</Badge>
}
export function ImportStatusBadge({ status }: { status: string }) {
  const s = IMPORT_STATUS[status] ?? { label: status, variant: 'muted' as const }
  return <Badge variant={s.variant}>{s.label}</Badge>
}
export function AccessBadge({ level }: { level: string }) {
  if (level === 'biasa') return null
  return <Badge variant={level === 'rahasia' ? 'danger' : 'warning'}>{accessLabel(level)}</Badge>
}
export function SourceBadge({ source, manual }: { source: string; manual?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={source === 'import' ? 'default' : 'muted'}>{source === 'import' ? 'SiCANTIK' : 'Manual'}</Badge>
      {manual && (
        <Tooltip content="Data impor ini pernah diubah manual. Impor berikutnya akan meminta konfirmasi sebelum menimpa.">
          <span className="inline-flex text-warning" aria-label="Diubah manual"><PencilLine className="size-3.5" /></span>
        </Tooltip>
      )}
    </span>
  )
}
