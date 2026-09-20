// frontend/src/pages/IndexingPage.tsx
import { useState } from 'react'
import { FolderPanel } from '../components/FolderPanel'
import { ImportPanel } from '../components/ImportPanel'
import { JobHistory } from '../components/JobHistory'
import { JobProgress } from '../components/JobProgress'
import type { Library } from '../hooks/useLibrary'

interface Props {
  library: Library
}

export function IndexingPage({ library }: Props) {
  const [confirming, setConfirming] = useState(false)
  const running = library.status?.status === 'running'

  return (
    <section className="page">
      {library.error ? (
        <p role="alert" className="error">
          {library.error}
        </p>
      ) : null}

      <FolderPanel
        folders={library.folders}
        busy={library.busy}
        running={running}
        onAdd={library.addLibraryFolder}
        onRemove={(path) => void library.removeLibraryFolder(path)}
      />

      <ImportPanel
        busy={library.busy}
        running={running}
        lastUpload={library.lastUpload}
        onImport={library.importFiles}
      />

      <JobProgress status={library.status} busy={library.busy} onIndex={() => library.runIndexing()} />

      <JobHistory jobs={library.jobs} />

      <section className="panel danger">
        <h2>Clear the index</h2>
        <p className="hint">
          Removes every passage and every document record. Your PDFs stay in the documents
          folder and the job history is kept, so you can index again from scratch.
        </p>
        {confirming ? (
          <div className="confirm">
            <p>
              Clear all indexing? {library.documents.length} document
              {library.documents.length === 1 ? '' : 's'} will stop being searchable.
            </p>
            <button
              type="button"
              className="destructive"
              disabled={library.busy || running}
              onClick={() => {
                setConfirming(false)
                void library.clearAll()
              }}
            >
              Yes, clear it
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="destructive"
            disabled={library.busy || running}
            onClick={() => setConfirming(true)}
          >
            Clear all indexing
          </button>
        )}
        {library.lastClear ? (
          <p className="hint">
            Cleared {library.lastClear.documents_removed} documents and{' '}
            {library.lastClear.passages_removed} passages. The PDF files were kept.
          </p>
        ) : null}
      </section>
    </section>
  )
}
