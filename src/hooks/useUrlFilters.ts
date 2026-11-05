import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ArchiveFilters } from '@/lib/api'

const KEYS: (keyof ArchiveFilters)[] = [
  'q', 'year', 'dateFrom', 'dateTo', 'issuedFrom', 'issuedTo', 'permitTypeId', 'sector', 'status', 'permitStatus',
  'applicationType', 'classificationId', 'complete', 'hasPermit', 'dataSource', 'manualEdited', 'accessLevel',
  'applicantId', 'companyId', 'location', 'importBatchId', 'missingCategory',
]

/** Filter arsip disimpan di URL agar dapat dibagikan & bertahan saat kembali. */
export function useUrlFilters(): [ArchiveFilters, (f: ArchiveFilters) => void] {
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => {
    const f: ArchiveFilters = {}
    KEYS.forEach((k) => { const v = params.get(k); if (v) f[k] = v })
    return f
  }, [params])
  const set = useCallback((f: ArchiveFilters) => {
    const next = new URLSearchParams()
    KEYS.forEach((k) => { if (f[k]) next.set(k, String(f[k])) })
    setParams(next, { replace: true })
  }, [setParams])
  return [filters, set]
}
