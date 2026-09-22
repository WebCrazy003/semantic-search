// frontend/src/components/DocumentList.tsx
import { useMemo, useState } from 'react'
import { usePagination } from '../hooks/usePagination'
import { documentFileUrl, type DocumentSummary } from '../services/api'
import { Pagination } from './Pagination'
import { StatusBadge } from './StatusBadge'

interface Props {
  documents: DocumentSummary[]
  busy?: boolean
  onRemove?: (documentId: string) => void
}

type SortKey = 'filename' | 'file_size' | 'pages' | 'chunks' | 'language' | 'status' | 'indexed_at'

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'filename', label: 'File' },
  { key: 'file_size', label: 'Size', numeric: true },
  { key: 'pages', label: 'Pages', numeric: true },
  { key: 'chunks', label: 'Passages', numeric: true },
  { key: 'language', label: 'Language' },
  { key: 'status', label: 'Status' },
  { key: 'indexed_at', label: 'Indexed' },
]

export function DocumentList({ documents, busy = false, onRemove }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({
    key: 'filename',
    ascending: true,
  })

  const sorted = useMemo(() => {
    const rows = [...documents]
    rows.sort((left, right) => compare(left[sort.key], right[sort.key]))
    return sort.ascending ? rows : rows.reverse()
  }, [documents, sort])

  const paged = usePagination(sorted, 10)

  if (documents.length === 0) {
    return (
      <p className="hint empty">
        No documents indexed yet. Import PDF or Word files on the Indexing tab, or put them in
        the documents folder and run a job.
      </p>
    )
  }

  function toggle(key: SortKey) {
    setSort((current) =>
      current.key === key ? { key, ascending: !current.ascending } : { key, ascending: true },
    )
  }

  return (
    <>
      <div className="table-wrap">
        <table className="documents">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className={column.numeric ? 'numeric' : undefined}
                  aria-sort={
                    sort.key === column.key
                      ? sort.ascending
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  <button type="button" className="sort" onClick={() => toggle(column.key)}>
                    {column.label}
                    <span className="sort-arrow" aria-hidden="true">
                      {sort.key === column.key ? (sort.ascending ? '▲' : '▼') : '⇅'}
                    </span>
                  </button>
                </th>
              ))}
              {onRemove ? <th>Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {paged.items.map((document) => (
              <tr key={document.document_id}>
                <td title={document.filepath}>
                  {document.status === 'failed' ? (
                    <span className="filename">{document.filename}</span>
                  ) : (
                    <a
                      className="filename open-source"
                      href={documentFileUrl(document.document_id)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {document.filename} {document.file_type === 'docx' ? '↓' : '↗'}
                    </a>
                  )}
                  {document.file_type === 'docx' ? (
                    <span className="badge subtle file-type">DOCX</span>
                  ) : null}
                  {document.title ? <span className="doc-title">{document.title}</span> : null}
                  {document.error_message ? (
                    <span className="doc-error">{document.error_message}</span>
                  ) : null}
                  {document.alt_filepaths.length > 0 ? (
                    <span className="doc-title">
                      also at {document.alt_filepaths.length} other path
                      {document.alt_filepaths.length === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </td>
                <td className="numeric">{formatSize(document.file_size)}</td>
                <td
                  className="numeric"
                  title={
                    document.pages_approximate
                      ? 'Approximate: a Word file has no fixed pages'
                      : undefined
                  }
                >
                  {document.pages_approximate ? `~${document.pages}` : document.pages}
                </td>
                <td className="numeric">{document.chunks}</td>
                <td>{document.language ?? '-'}</td>
                <td>
                  <StatusBadge status={document.status} />
                </td>
                <td className="muted">{formatTime(document.indexed_at)}</td>
                {onRemove ? (
                  <td>
                    {confirming === document.document_id ? (
                      <span className="confirm-inline">
                        <button
                          type="button"
                          className="destructive"
                          disabled={busy}
                          onClick={() => {
                            setConfirming(null)
                            onRemove(document.document_id)
                          }}
                        >
                          Confirm
                        </button>
                        <button type="button" onClick={() => setConfirming(null)}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        aria-label={`Remove ${document.filename} from the index`}
                        onClick={() => setConfirming(document.document_id)}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination paged={paged} label="documents" />
    </>
  )
}

function compare(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true })
}

function formatSize(bytes: number): string {
  if (!bytes) return '-'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(iso?: string | null): string {
  if (!iso) return '-'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}
