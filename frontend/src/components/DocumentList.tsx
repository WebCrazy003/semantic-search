// frontend/src/components/DocumentList.tsx
import { useState } from 'react'
import type { DocumentSummary } from '../services/api'

interface Props {
  documents: DocumentSummary[]
  busy?: boolean
  onRemove?: (documentId: string) => void
}

export function DocumentList({ documents, busy = false, onRemove }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null)

  if (documents.length === 0) {
    return (
      <p className="hint">
        No documents indexed yet. Import PDFs on the Indexing tab, or put them in the documents
        folder and run a job.
      </p>
    )
  }

  return (
    <table className="documents">
      <thead>
        <tr>
          <th>File</th>
          <th>Size</th>
          <th>Pages</th>
          <th>Passages</th>
          <th>Language</th>
          <th>Status</th>
          <th>Indexed</th>
          {onRemove ? <th>Action</th> : null}
        </tr>
      </thead>
      <tbody>
        {documents.map((document) => (
          <tr key={document.document_id}>
            <td title={document.filepath}>
              <span className="filename">{document.filename}</span>
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
            <td>{formatSize(document.file_size)}</td>
            <td>{document.pages}</td>
            <td>{document.chunks}</td>
            <td>{document.language ?? '-'}</td>
            <td>{document.status}</td>
            <td>{formatTime(document.indexed_at)}</td>
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
  )
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
