import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import { getArchiveYears, listClassifications, listPermitTypes, type ArchiveFilters } from '@/lib/api'
import { ACCESS_LEVELS, APPLICATION_STATUS, APPLICATION_TYPES, DOCUMENT_CATEGORIES, PERMIT_STATUS } from '@/lib/constants'
import { useDebounce } from '@/hooks/useDebounce'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchInput } from '@/components/common/SearchInput'

interface Props {
  value: ArchiveFilters
  onChange: (f: ArchiveFilters) => void
  /** compact: baris filter ringkas; advanced: panel pencarian lanjutan */
  variant?: 'compact' | 'advanced'
  hide?: (keyof ArchiveFilters)[]
}

function Field({ label, children, id }: { label: string; children: React.ReactNode; id: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

export function ArchiveFilterPanel({ value, onChange, variant = 'compact', hide = [] }: Props) {
  const [text, setText] = useState(value.q ?? '')
  const debounced = useDebounce(text)
  const [open, setOpen] = useState(variant === 'advanced')
  useEffect(() => { if ((value.q ?? '') !== debounced) onChange({ ...value, q: debounced || undefined }) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debounced])
  useEffect(() => { setText(value.q ?? '') }, [value.q])

  const years = useQuery({ queryKey: ['archive_years'], queryFn: getArchiveYears })
  const types = useQuery({ queryKey: ['permit_types'], queryFn: listPermitTypes })
  const classes = useQuery({ queryKey: ['classifications'], queryFn: listClassifications })
  const sectors = Array.from(new Set(types.data?.map((t) => t.sector))).sort()

  const set = (k: keyof ArchiveFilters, v: string) => onChange({ ...value, [k]: v || undefined })
  const show = (k: keyof ArchiveFilters) => !hide.includes(k)
  const activeCount = Object.entries(value).filter(([k, v]) => k !== 'q' && v).length

  const sel = (k: keyof ArchiveFilters, label: string, options: [string, string][], all = 'Semua') => show(k) && (
    <Field label={label} id={`f-${k}`}>
      <NativeSelect id={`f-${k}`} value={value[k] ?? ''} onChange={(e) => set(k, e.target.value)}>
        <option value="">{all}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </NativeSelect>
    </Field>
  )
  const date = (k: keyof ArchiveFilters, label: string) => show(k) && (
    <Field label={label} id={`f-${k}`}><Input id={`f-${k}`} type="date" value={value[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></Field>
  )

  return (
    <div className="border-b">
      <div className="flex flex-col gap-2 p-3 md:flex-row md:items-center">
        <SearchInput value={text} onChange={setText} className="md:w-[28rem]" placeholder="Nomor permohonan, pemohon, NIK, nomor izin, lokasi…" />
        <div className="flex flex-wrap gap-2">
          {variant === 'compact' && (
            <>
              {show('year') && (
                <NativeSelect aria-label="Tahun" className="w-32" value={value.year ?? ''} onChange={(e) => set('year', e.target.value)}>
                  <option value="">Semua tahun</option>
                  {years.data?.map((y) => <option key={y} value={y}>{y}</option>)}
                </NativeSelect>
              )}
              {show('status') && (
                <NativeSelect aria-label="Status" className="w-40" value={value.status ?? ''} onChange={(e) => set('status', e.target.value)}>
                  <option value="">Semua status</option>
                  {Object.entries(APPLICATION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </NativeSelect>
              )}
            </>
          )}
          <Button variant={open ? 'secondary' : 'outline'} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <SlidersHorizontal /> Filter{activeCount ? ` (${activeCount})` : ''}
          </Button>
          {(activeCount > 0 || value.q) && (
            <Button variant="ghost" onClick={() => { setText(''); onChange({}) }}><RotateCcw /> Atur ulang</Button>
          )}
        </div>
      </div>
      {open && (
        <div className="grid gap-3 border-t bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {variant === 'advanced' && sel('year', 'Tahun', (years.data ?? []).map((y) => [String(y), String(y)]))}
          {date('dateFrom', 'Tanggal permohonan dari')}
          {date('dateTo', 'Tanggal permohonan sampai')}
          {show('permitTypeId') && (
            <Field label="Jenis izin" id="f-pt">
              <NativeSelect id="f-pt" value={value.permitTypeId ?? ''} onChange={(e) => set('permitTypeId', e.target.value)}>
                <option value="">Semua jenis izin</option>
                {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </NativeSelect>
            </Field>
          )}
          {sel('sector', 'Sektor', sectors.map((s) => [s, s]))}
          {sel('applicationType', 'Jenis permohonan', APPLICATION_TYPES.map((t) => [t, t]))}
          {variant === 'advanced' && sel('status', 'Status permohonan', Object.entries(APPLICATION_STATUS).map(([k, v]) => [k, v.label]))}
          {sel('hasPermit', 'Izin terbit', [['yes', 'Sudah terbit'], ['no', 'Belum terbit']])}
          {sel('permitStatus', 'Status izin', Object.entries(PERMIT_STATUS).map(([k, v]) => [k, v.label]))}
          {date('issuedFrom', 'Tanggal penetapan dari')}
          {date('issuedTo', 'Tanggal penetapan sampai')}
          {sel('complete', 'Kelengkapan dokumen', [['no', 'Belum lengkap'], ['yes', 'Lengkap']])}
          {sel('missingCategory', 'Kurang dokumen', DOCUMENT_CATEGORIES.map((c) => [c.value, c.label]))}
          {show('classificationId') && (
            <Field label="Klasifikasi" id="f-cl">
              <NativeSelect id="f-cl" value={value.classificationId ?? ''} onChange={(e) => set('classificationId', e.target.value)}>
                <option value="">Semua klasifikasi</option>
                <option value="none">Belum diklasifikasikan</option>
                {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </NativeSelect>
            </Field>
          )}
          {sel('accessLevel', 'Tingkat akses', ACCESS_LEVELS.map((a) => [a.value, a.label]))}
          {sel('dataSource', 'Sumber data', [['import', 'Impor SiCANTIK'], ['manual', 'Input manual']])}
          {sel('manualEdited', 'Edit manual', [['yes', 'Pernah diubah manual']])}
          {show('location') && (
            <Field label="Lokasi" id="f-loc"><Input id="f-loc" value={value.location ?? ''} placeholder="Kelurahan, kecamatan, fasilitas…" onChange={(e) => set('location', e.target.value)} /></Field>
          )}
        </div>
      )}
    </div>
  )
}
