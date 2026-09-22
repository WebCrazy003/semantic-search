// frontend/src/pages/DocumentsPage.tsx
import { DocumentList } from '../components/DocumentList'
import type { Library } from '../hooks/useLibrary'

interface Props {
  library: Library
}

export function DocumentsPage({ library }: Props) {
  const { documents, status, error, busy } = library
  const indexed = documents.filter((document) => document.status === 'indexed')
  const passages = indexed.reduce((total, document) => total + document.chunks, 0)
  const running = status?.status === 'running'

  return (
    <section className="page">
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      <div className="library-summary">
        <span>
          <strong>{documents.length}</strong> document{documents.length === 1 ? '' : 's'} known
        </span>
        <span>
          <strong>{indexed.length}</strong> searchable
        </span>
        <span>
          <strong>{passages}</strong> passages
        </span>
        <button type="button" onClick={() => void library.refresh()} disabled={busy}>
          Refresh
        </button>
      </div>

      {running ? <p className="hint">A job is running; this list updates as it goes.</p> : null}

      <DocumentList
        documents={documents}
        busy={busy || running}
        onRemove={(documentId) => void library.remove(documentId)}
      />

      <p className="hint">
        Remove takes a document out of the search index. The file stays in the documents folder,
        so the next indexing job picks it up again.
      </p>
    </section>
  )
}
