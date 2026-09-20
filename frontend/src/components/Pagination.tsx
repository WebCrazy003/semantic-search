// frontend/src/components/Pagination.tsx
import { PAGE_SIZES, type Paged } from '../hooks/usePagination'

interface Props {
  paged: Paged<unknown>
  label: string
}

export function Pagination({ paged, label }: Props) {
  const { page, pageCount, from, to, total } = paged
  if (total === 0) return null

  return (
    <nav className="pagination" aria-label={`${label} pagination`}>
      <span className="page-info">
        {from}–{to} of {total} {label}
      </span>

      <label className="page-size">
        Rows
        <select
          value={paged.pageSize}
          aria-label={`${label} per page`}
          onChange={(event) => paged.setPageSize(Number(event.target.value))}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>

      <span className="page-buttons">
        <button
          type="button"
          aria-label="First page"
          disabled={page === 1}
          onClick={() => paged.setPage(1)}
        >
          «
        </button>
        <button
          type="button"
          aria-label="Previous page"
          disabled={page === 1}
          onClick={() => paged.setPage(page - 1)}
        >
          ‹
        </button>
        <span className="page-current" aria-live="polite">
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          aria-label="Next page"
          disabled={page === pageCount}
          onClick={() => paged.setPage(page + 1)}
        >
          ›
        </button>
        <button
          type="button"
          aria-label="Last page"
          disabled={page === pageCount}
          onClick={() => paged.setPage(pageCount)}
        >
          »
        </button>
      </span>
    </nav>
  )
}
