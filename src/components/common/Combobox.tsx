import { useEffect, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { useDebounce } from '@/hooks/useDebounce'
import { cn } from '@/lib/utils'

export interface ComboOption {
  value: string
  label: string
  hint?: string
}

interface Props {
  value: string | null
  onChange: (value: string | null, option?: ComboOption) => void
  /** Ambil opsi berdasarkan teks pencarian */
  fetchOptions: (search: string) => Promise<ComboOption[]>
  /** Ambil label untuk nilai terpilih saat pertama tampil */
  fetchSelected?: (value: string) => Promise<ComboOption | null>
  queryKey: string
  placeholder?: string
  allowClear?: boolean
  invalid?: boolean
  id?: string
  disabled?: boolean
}

export function Combobox({ value, onChange, fetchOptions, fetchSelected, queryKey, placeholder = 'Pilih…', allowClear, invalid, id, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ComboOption | null>(null)
  const debounced = useDebounce(search, 250)

  const { data, isFetching } = useQuery({
    queryKey: ['combo', queryKey, debounced],
    queryFn: () => fetchOptions(debounced),
    enabled: open,
  })

  useEffect(() => {
    if (!value) { setSelected(null); return }
    if (selected?.value === value || !fetchSelected) return
    let alive = true
    fetchSelected(value).then((o) => alive && setSelected(o))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild disabled={disabled}>
        <button
          id={id}
          type="button"
          aria-invalid={invalid || undefined}
          className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-sm shadow-xs aria-invalid:border-destructive disabled:opacity-60"
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground/80')}>{selected?.label ?? placeholder}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className="z-50 w-[var(--radix-popover-trigger-width)] min-w-72 rounded-lg border bg-popover p-1 shadow-lg">
          <div className="relative mb-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ketik untuk mencari…"
              className="h-9 w-full rounded-md border-0 bg-muted pl-8 pr-2 text-sm outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto" role="listbox">
            {allowClear && value && (
              <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
                onClick={() => { onChange(null); setSelected(null); setOpen(false) }}>
                Kosongkan pilihan
              </button>
            )}
            {isFetching && !data && <p className="px-2 py-3 text-sm text-muted-foreground">Mencari…</p>}
            {data?.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">Tidak ditemukan.</p>}
            {data?.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => { onChange(o.value, o); setSelected(o); setOpen(false) }}
              >
                <Check className={cn('mt-0.5 size-4 shrink-0 text-primary', o.value === value ? 'opacity-100' : 'opacity-0')} />
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>}
                </span>
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
