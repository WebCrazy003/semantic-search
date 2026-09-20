// frontend/src/components/JobProgress.tsx
import type { IndexStatus } from '../services/api'

interface Props {
  status: IndexStatus | null
  busy: boolean
  onIndex: () => void
}

export function JobProgress({ status, busy, onIndex }: Props) {
  const running = status?.status === 'running'
  const total = status?.total_documents ?? 0
  const processed = status?.processed_documents ?? 0
  // Before discovery finishes total is 0, so the bar would read 100%; show 0 instead.
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0

  return (
    <section className="panel">
      <h2>Indexing job</h2>

      <div className="index-actions">
        <button type="button" onClick={onIndex} disabled={running || busy}>
          {running ? 'Indexing...' : 'Index documents folder'}
        </button>
        {status?.directory ? <code className="index-dir">{status.directory}</code> : null}
      </div>

      {status && status.status !== 'idle' ? (
        <>
          <div className="progress-line">
            <div
              className="progress"
              role="progressbar"
              aria-label="Indexing progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={running ? percent : 100}
            >
              <span style={{ width: `${running ? percent : 100}%` }} />
            </div>
            <span className="progress-text">
              {running
                ? `${processed} of ${total} files${status.current_file ? ` — ${status.current_file}` : ''}`
                : `${status.status} — ${processed} of ${total} files`}
            </span>
          </div>

          <dl className="index-counters">
            <div>
              <dt>State</dt>
              <dd>{status.status}</dd>
            </div>
            <div>
              <dt>Started by</dt>
              <dd>{status.trigger === 'upload' ? 'import' : 'folder scan'}</dd>
            </div>
            <div>
              <dt>Indexed</dt>
              <dd>{status.indexed_documents}</dd>
            </div>
            <div>
              <dt>Passages</dt>
              <dd>{status.total_chunks}</dd>
            </div>
            <div>
              <dt>Skipped</dt>
              <dd>{status.skipped_documents}</dd>
            </div>
            <div>
              <dt>Unsupported</dt>
              <dd>{status.unsupported_documents}</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>{status.failed_documents}</dd>
            </div>
            <div>
              <dt>Removed</dt>
              <dd>{status.deleted_documents}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="hint">No job has run in this session yet.</p>
      )}

      {status && status.failures.length > 0 ? (
        <ul className="index-failures">
          {status.failures.map((failure) => (
            <li key={failure.filepath}>
              <strong>{failure.filename}</strong>
              <span>
                {failure.error_type}: {failure.error_message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
