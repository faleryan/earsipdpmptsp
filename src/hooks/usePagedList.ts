import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { SortState } from '@/components/common/DataTable'

interface Options {
  queryKey: unknown[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: () => any
  defaultSort: SortState
  pageSize?: number
  enabled?: boolean
  /** kolom unik pengurut kedua agar paging stabil */
  tieBreaker?: string
}

/** Daftar berhalaman dengan count exact, urutan, dan reset halaman saat filter berubah. */
export function usePagedList<T>({ queryKey, build, defaultSort, pageSize = 25, enabled = true, tieBreaker = 'id' }: Options) {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(pageSize)
  const [sort, setSort] = useState<SortState>(defaultSort)
  const filterKey = JSON.stringify(queryKey)
  const prev = useRef(filterKey)
  useEffect(() => {
    if (prev.current !== filterKey) {
      prev.current = filterKey
      setPage(1)
    }
  }, [filterKey])

  const query = useQuery({
    queryKey: [...queryKey, page, size, sort],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const from = (page - 1) * size
      const { data, count, error } = await build()
        .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
        .order(tieBreaker, { ascending: true })
        .range(from, from + size - 1)
      if (error) throw error
      return { rows: (data ?? []) as T[], total: count ?? 0 }
    },
  })

  return {
    ...query,
    rows: query.data?.rows,
    total: query.data?.total ?? 0,
    page,
    setPage,
    pageSize: size,
    setPageSize: (n: number) => { setSize(n); setPage(1) },
    sort,
    setSort,
  }
}
