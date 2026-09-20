// frontend/src/components/IndexStatus.tsx
import type { IndexStatus as Status } from '../services/api'

interface Props {
  status: Status | null
  busy: boolean
  onIndex: () => void
}

export function IndexStatus({ status, busy, onIndex }: Props) {
  const running = status?.status === 'running' || busy
  return (
    <div className="index-status">
      <div className="index-actions">
        <button type="button" onClick={onIndex} disabled={running}>
          {running ? 'Indexing...' : 'Index documents'}
        </button>
        {status?.directory ? <code className="index-dir">{status.directory}</code> : null}
      </div>

      {status && status.status !== 'idle' ? (
        <dl className="index-counters">
          <div>
            <dt>State</dt>
            <dd>{status.status}</dd>
          </div>
          <div>
            <dt>Documents</dt>
            <dd>
              {status.indexed_documents} of {status.total_documents} indexed
            </dd>
          </div>
          <div>
            <dt>Passages</dt>
            <dd>{status.total_chunks} passages</dd>
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
        </dl>
      ) : null}

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
    </div>
  )
}
