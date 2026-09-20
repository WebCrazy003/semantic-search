// frontend/src/components/FolderPanel.tsx
import { useState } from 'react'
import type { FolderSummary } from '../services/api'

interface Props {
  folders: FolderSummary[]
  busy: boolean
  running: boolean
  onAdd: (path: string) => Promise<boolean>
  onRemove: (path: string) => void
}

export function FolderPanel({ folders, busy, running, onAdd, onRemove }: Props) {
  const [path, setPath] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const blocked = busy || running

  async function submit() {
    if (await onAdd(path)) setPath('')
  }

  return (
    <section className="panel">
      <h2>Folders</h2>

      <p className="hint">
        A folder is read where it is. Nothing is copied, and the index stores the real path of
        every PDF, including the ones in subfolders.
      </p>

      <div className="folder-row">
        <input
          type="text"
          aria-label="Folder path to index in place"
          placeholder="/Users/you/Documents/manuals"
          value={path}
          spellCheck={false}
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <button type="button" onClick={() => void submit()} disabled={blocked || !path.trim()}>
          Add folder
        </button>
      </div>

      <p className="hint small">
        Paste the full path. In Finder, right-click the folder, hold Option, and choose “Copy as
        Pathname”. The browser cannot read a folder you pick with a file dialog, which is why this
        is typed rather than browsed.
      </p>

      <ul className="folders">
        {folders.map((folder) => (
          <li key={folder.path} className={folder.readable ? undefined : 'missing'}>
            <div className="folder-main">
              <code>{folder.path}</code>
              <span className="folder-meta">
                {folder.is_default ? <span className="badge subtle">default</span> : null}
                {folder.readable ? (
                  <>
                    {folder.pdf_count} PDF{folder.pdf_count === 1 ? '' : 's'} on disk ·{' '}
                    {folder.indexed_documents} indexed
                  </>
                ) : (
                  <span className="badge warn">
                    <span className="dot" aria-hidden="true" />
                    not readable
                  </span>
                )}
              </span>
            </div>

            {folder.is_default ? null : confirming === folder.path ? (
              <span className="confirm-inline">
                <button
                  type="button"
                  className="destructive"
                  disabled={blocked}
                  onClick={() => {
                    setConfirming(null)
                    onRemove(folder.path)
                  }}
                >
                  Remove {folder.indexed_documents} from the index
                </button>
                <button type="button" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="ghost"
                disabled={blocked}
                aria-label={`Stop indexing ${folder.path}`}
                onClick={() => setConfirming(folder.path)}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
