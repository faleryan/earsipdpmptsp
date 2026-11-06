import { Input } from '@/components/ui/input'
import { FormField } from './FormField'
import type { Signatory } from '@/lib/recapExport'

export function SignatoryFields({ prefix, value, onChange }: { prefix: string; value: Signatory; onChange: (s: Signatory) => void }) {
  const f = (k: keyof Signatory) => ({ value: value[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value }) })
  return (
    <div className="grid gap-3">
      <FormField label="Teks pembuka" htmlFor={`${prefix}-label`} hint="Mis. “Mengetahui,” (boleh kosong)"><Input id={`${prefix}-label`} {...f('label')} /></FormField>
      <FormField label="Jabatan" htmlFor={`${prefix}-title`}><Input id={`${prefix}-title`} {...f('title')} /></FormField>
      <FormField label="Nama lengkap & gelar" htmlFor={`${prefix}-name`}><Input id={`${prefix}-name`} {...f('name')} /></FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Pangkat / golongan" htmlFor={`${prefix}-rank`}><Input id={`${prefix}-rank`} {...f('rank')} placeholder="Pembina Tk. I (IV/b)" /></FormField>
        <FormField label="NIP" htmlFor={`${prefix}-nip`}><Input id={`${prefix}-nip`} inputMode="numeric" {...f('nip')} /></FormField>
      </div>
    </div>
  )
}
