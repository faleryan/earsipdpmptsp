import { DOCUMENT_CATEGORIES, categoryLabel } from '@/lib/constants'
import { Tooltip } from '@/components/ui/misc'
import { cn } from '@/lib/utils'
import type { DocumentCategory } from '@/types'

/**
 * Penanda kelengkapan berkas berbentuk "tab map arsip".
 * Satu tab per kategori wajib: terisi biru = ada dokumen, garis putus = belum ada.
 */
export function DocumentTabs({
  required, present, size = 'sm', showLabels = false,
}: { required: DocumentCategory[]; present: DocumentCategory[]; size?: 'sm' | 'md'; showLabels?: boolean }) {
  const cats = DOCUMENT_CATEGORIES.filter((c) => required.includes(c.value))
  if (!cats.length) return <span className="text-xs text-muted-foreground">Tanpa syarat</span>
  const done = cats.filter((c) => present.includes(c.value)).length
  return (
    <Tooltip
      content={
        <div className="space-y-0.5">
          <p className="font-semibold">{done} dari {cats.length} dokumen wajib</p>
          {cats.map((c) => <p key={c.value}>{present.includes(c.value) ? '✓' : '○'} {categoryLabel(c.value)}</p>)}
        </div>
      }
    >
      <span className="inline-flex items-end gap-[3px]" aria-label={`Kelengkapan ${done} dari ${cats.length}`}>
        {cats.map((c) => {
          const ok = present.includes(c.value)
          return (
            <span key={c.value} className="flex flex-col items-center gap-0.5">
              <span
                className={cn(
                  'rounded-t-[3px] border',
                  size === 'sm' ? 'h-3 w-3.5' : 'h-4 w-6',
                  ok ? 'border-primary bg-primary' : 'border-dashed border-[#9fb0c6] bg-transparent',
                )}
              />
              {showLabels && <span className="text-[10px] leading-none text-muted-foreground">{c.short}</span>}
            </span>
          )
        })}
      </span>
    </Tooltip>
  )
}
