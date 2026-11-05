import { supabase } from './supabase'
import { likePattern, pgrstQuote } from './utils'
import type { ComboOption } from '@/components/common/Combobox'
import type { Classification, PermitType } from '@/types'

/* ------------------------------------------------------------------ */
/* Opsi combobox                                                       */
/* ------------------------------------------------------------------ */
export async function searchApplicants(search: string): Promise<ComboOption[]> {
  let q = supabase.from('applicants').select('id, full_name, nik, phone').order('full_name').limit(30)
  if (search.trim()) {
    const s = search.trim()
    q = q.or(`full_name.ilike.${pgrstQuote(likePattern(s))},nik.ilike.${pgrstQuote(likePattern(s))}`)
  }
  const { data, error } = await q
  if (error) throw error
  return data.map((a) => ({ value: a.id, label: a.full_name, hint: [a.nik, a.phone].filter(Boolean).join(' · ') }))
}
export async function getApplicantOption(id: string): Promise<ComboOption | null> {
  const { data } = await supabase.from('applicants').select('id, full_name, nik').eq('id', id).maybeSingle()
  return data ? { value: data.id, label: data.full_name, hint: data.nik ?? undefined } : null
}

export async function searchCompanies(search: string): Promise<ComboOption[]> {
  let q = supabase.from('companies').select('id, name, nib, business_form').order('name').limit(30)
  if (search.trim()) q = q.or(`name.ilike.${pgrstQuote(likePattern(search.trim()))},nib.ilike.${pgrstQuote(likePattern(search.trim()))}`)
  const { data, error } = await q
  if (error) throw error
  return data.map((c) => ({ value: c.id, label: c.name, hint: [c.business_form, c.nib].filter(Boolean).join(' · ') }))
}
export async function getCompanyOption(id: string): Promise<ComboOption | null> {
  const { data } = await supabase.from('companies').select('id, name').eq('id', id).maybeSingle()
  return data ? { value: data.id, label: data.name } : null
}

export async function searchPermitTypes(search: string): Promise<ComboOption[]> {
  let q = supabase.from('permit_types').select('id, name, sector').eq('is_active', true).order('name').limit(50)
  if (search.trim()) q = q.ilike('name', likePattern(search.trim()).replace(/\*/g, '%'))
  const { data, error } = await q
  if (error) throw error
  return data.map((p) => ({ value: p.id, label: p.name, hint: p.sector }))
}
export async function getPermitTypeOption(id: string): Promise<ComboOption | null> {
  const { data } = await supabase.from('permit_types').select('id, name, sector').eq('id', id).maybeSingle()
  return data ? { value: data.id, label: data.name, hint: data.sector } : null
}

export async function listPermitTypes() {
  const { data, error } = await supabase.from('permit_types').select('*, classification:classifications(id, code, name)').order('name')
  if (error) throw error
  return data as PermitType[]
}

export async function listClassifications() {
  const { data, error } = await supabase.from('classifications').select('*').order('code')
  if (error) throw error
  return data as Classification[]
}

export async function listSectors() {
  const { data, error } = await supabase.from('permit_types').select('sector')
  if (error) throw error
  return Array.from(new Set(data.map((d) => d.sector))).sort()
}

export async function getArchiveYears() {
  const { data, error } = await supabase.rpc('get_archive_years')
  if (error) throw error
  return (data ?? []) as number[]
}

/* ------------------------------------------------------------------ */
/* Filter arsip (view v_archive_list)                                  */
/* ------------------------------------------------------------------ */
export interface ArchiveFilters {
  q?: string
  year?: string
  dateFrom?: string
  dateTo?: string
  issuedFrom?: string
  issuedTo?: string
  permitTypeId?: string
  sector?: string
  status?: string
  permitStatus?: string
  applicationType?: string
  classificationId?: string
  complete?: string
  hasPermit?: string
  dataSource?: string
  manualEdited?: string
  accessLevel?: string
  applicantId?: string
  companyId?: string
  location?: string
  importBatchId?: string
  missingCategory?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyArchiveFilters<Q extends { [k: string]: any }>(query: Q, f: ArchiveFilters): Q {
  let q = query
  const s = f.q?.trim()
  const loc = f.location?.trim()
  const textParts = s
    ? (() => {
        const p = pgrstQuote(likePattern(s))
        return [
          `application_number.ilike.${p}`,
          `applicant_name.ilike.${p}`,
          `applicant_nik.ilike.${p}`,
          `permit_number.ilike.${p}`,
          `permit_type_name.ilike.${p}`,
          `permit_location.ilike.${p}`,
          `location.ilike.${p}`,
          `company_name.ilike.${p}`,
          `archive_code.ilike.${p}`,
          `source_id.eq.${pgrstQuote(s)}`,
        ].join(',')
      })()
    : null
  const locParts = loc
    ? `location.ilike.${pgrstQuote(likePattern(loc))},permit_location.ilike.${pgrstQuote(likePattern(loc))}`
    : null
  // PostgREST hanya menerima satu parameter "or"; gabungkan bila keduanya ada.
  if (textParts && locParts) q = q.or(`and(or(${textParts}),or(${locParts}))`)
  else if (textParts) q = q.or(textParts)
  else if (locParts) q = q.or(locParts)
  if (f.year) q = q.eq('application_year', Number(f.year))
  if (f.dateFrom) q = q.gte('application_date', f.dateFrom)
  if (f.dateTo) q = q.lte('application_date', f.dateTo)
  if (f.issuedFrom) q = q.gte('issued_date', f.issuedFrom)
  if (f.issuedTo) q = q.lte('issued_date', f.issuedTo)
  if (f.permitTypeId) q = q.eq('permit_type_id', f.permitTypeId)
  if (f.sector) q = q.eq('sector', f.sector)
  if (f.status) q = q.eq('status', f.status)
  if (f.permitStatus) q = q.eq('permit_status', f.permitStatus)
  if (f.applicationType) q = q.eq('application_type', f.applicationType)
  if (f.classificationId === 'none') q = q.is('classification_id', null)
  else if (f.classificationId) q = q.eq('classification_id', f.classificationId)
  if (f.complete === 'yes') q = q.eq('is_complete', true)
  if (f.complete === 'no') q = q.eq('is_complete', false)
  if (f.hasPermit === 'yes') q = q.not('permit_id', 'is', null)
  if (f.hasPermit === 'no') q = q.is('permit_id', null)
  if (f.dataSource) q = q.eq('data_source', f.dataSource)
  if (f.manualEdited === 'yes') q = q.eq('is_manually_edited', true)
  if (f.accessLevel) q = q.eq('access_level', f.accessLevel)
  if (f.applicantId) q = q.eq('applicant_id', f.applicantId)
  if (f.companyId) q = q.eq('company_id', f.companyId)
  if (f.importBatchId) q = q.eq('last_import_batch_id', f.importBatchId)
  if (f.missingCategory) q = q.contains('missing_documents', [f.missingCategory])
  return q
}

/** Ambil seluruh baris (untuk ekspor) secara bertahap. */
export async function fetchAllArchive(filters: ArchiveFilters, order = 'application_date', max = 20000) {
  const rows: Record<string, unknown>[] = []
  const page = 1000
  for (let from = 0; from < max; from += page) {
    const q = applyArchiveFilters(
      supabase.from('v_archive_list').select('*').order(order, { ascending: false }).order('id').range(from, from + page - 1),
      filters,
    )
    const { data, error } = await q
    if (error) throw error
    rows.push(...data)
    if (data.length < page) break
  }
  return rows
}

/** Baca filter dari URLSearchParams */
export function filtersFromParams(params: URLSearchParams, keys: (keyof ArchiveFilters)[]): ArchiveFilters {
  const f: ArchiveFilters = {}
  keys.forEach((k) => {
    const v = params.get(k)
    if (v) f[k] = v
  })
  return f
}
