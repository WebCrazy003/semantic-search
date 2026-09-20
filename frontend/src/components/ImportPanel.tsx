// frontend/src/components/ImportPanel.tsx
import { useRef, useState } from 'react'
import type { UploadResult } from '../services/api'

interface Props {
  busy: boolean
  running: boolean
  lastUpload: UploadResult | null
  onImport: (files: File[]) => void
}

export function ImportPanel({ busy, running, lastUpload, onImport }: Props) {
  const [chosen, setChosen] = useState<File[]>([])
  const input = useRef<HTMLInputElement>(null)

  function pick(files: FileList | null) {
    setChosen(files ? Array.from(files) : [])
  }

  function submit() {
    onImport(chosen)
    setChosen([])
    if (input.current) input.current.value = ''
  }

  const blocked = busy || running

  return (
    <section className="panel">
      <h2>Import PDFs</h2>

      <div className="import-row">
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          aria-label="PDF files to import"
          onChange={(event) => pick(event.target.files)}
        />
        <button type="button" onClick={submit} disabled={blocked || chosen.length === 0}>
          {chosen.length > 1 ? `Import ${chosen.length} files and index` : 'Import and index'}
        </button>
      </div>

      {chosen.length > 0 ? (
        <ul className="chosen-files">
          {chosen.map((file) => (
            <li key={file.name}>
              {file.name} <span className="muted">{formatSize(file.size)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {running ? (
        <p className="hint">A job is running. Importing is available again when it finishes.</p>
      ) : null}

      {lastUpload ? (
        <div className="upload-result">
          {lastUpload.saved.length > 0 ? (
            <p>
              Imported {lastUpload.saved.length} file{lastUpload.saved.length === 1 ? '' : 's'}:{' '}
              {lastUpload.saved.join(', ')}
            </p>
          ) : null}
          {lastUpload.rejected.length > 0 ? (
            <ul className="rejected" role="list">
              {lastUpload.rejected.map((item) => (
                <li key={item.filename}>
                  <strong>{item.filename}</strong> was not imported: {item.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <details className="limits">
        <summary>Which PDFs can be searched</summary>
        <div className="limits-body">
          <p className="works">Works</p>
          <ul>
            <li>PDFs whose text can be selected and copied in a PDF reader</li>
            <li>Chinese, Korean, English, and documents that mix them</li>
            <li>Tables, which are kept whole with their header row</li>
            <li>Files up to 200 MB each; several can be imported at once</li>
          </ul>
          <p className="works">Not supported in this version</p>
          <ul>
            <li>Scanned pages and photographs of pages, where the text is an image</li>
            <li>Password-protected PDFs</li>
            <li>Damaged files</li>
          </ul>
          <p className="hint">
            An unsupported file never stops a job. It is imported, listed on the Documents tab
            with its reason, and everything else still gets indexed.
          </p>
        </div>
      </details>
    </section>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
