// frontend/src/hooks/usePagination.ts
// Client-side paging. The manifest is one row per document, so even a few thousand
// rows arrive in one response; this only decides how many of them are on screen.

import { useEffect, useMemo, useState } from 'react'

export const PAGE_SIZES = [10, 25, 50, 100]

export interface Paged<T> {
  page: number
  pageSize: number
  pageCount: number
  from: number
  to: number
  total: number
  items: T[]
  setPage: (page: number) => void
  setPageSize: (size: number) => void
}

export function usePagination<T>(rows: T[], initialSize = 10): Paged<T> {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialSize)

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))

  // Deleting the last row of the last page would otherwise leave an empty view.
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const items = useMemo(
    () => rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize),
    [rows, page, pageSize],
  )

  return {
    page,
    pageSize,
    pageCount,
    from: rows.length === 0 ? 0 : (page - 1) * pageSize + 1,
    to: Math.min(rows.length, page * pageSize),
    total: rows.length,
    items,
    setPage: (next: number) => setPage(Math.min(Math.max(1, next), pageCount)),
    setPageSize: (size: number) => {
      setPageSize(size)
      setPage(1)
    },
  }
}
