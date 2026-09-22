// frontend/src/components/JobProgress.tsx
import type { IndexStatus } from '../services/api'
import { CountUp } from './CountUp'
import { DeviceStatus } from './DeviceStatus'
import { StatusBadge } from './StatusBadge'

interface Props {
  status: IndexStatus | null
  busy: boolean
  onIndex: () => void
}

export function JobProgress({ status, busy, onIndex }: Props) {
  const running = status?.status === 'running'
  const total = status?.total_documents ?? 0
  const processed = status?.processed_documents ?? 0
  const withinFile = status?.current_file_progress ?? 0

  // Counting the part-finished file makes the bar move while one long document is
  // being embedded, instead of standing still between whole files.
  const fraction = total > 0 ? Math.min(1, (processed + withinFile) / total) : 0
  const percent = Math.round(fraction * 100)
  // Before discovery finishes there is no total, so show a moving indeterminate bar.
  const indeterminate = running && total === 0

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Indexing job</h2>
        {status && status.status !== 'idle' ? (
          <StatusBadge status={status.status} pulse={running} />
        ) : null}
      </div>

      <div className="index-actions">
        <button type="button" className="primary" onClick={onIndex} disabled={running || busy}>
          {running ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Indexing…
            </>
          ) : (
            'Index documents folder'
          )}
        </button>
        {status?.directory ? <code className="index-dir">{status.directory}</code> : null}
      </div>

      {status && status.status !== 'idle' ? (
        <>
          <div className="progress-line">
            <div
              className={`progress${indeterminate ? ' indeterminate' : ''}`}
              role="progressbar"
              aria-label="Indexing progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={running ? percent : 100}
            >
              <span style={{ width: `${running ? percent : 100}%` }} />
            </div>
            <span className="progress-percent">{running ? `${percent}%` : 'done'}</span>
          </div>

          <p className="progress-text" aria-live="polite">
            {running ? (
              <>
                <strong>
                  {processed} of {total || '?'} files checked
                </strong>
                {status.current_file ? (
                  <>
                    {' — '}
                    <span className="current-file">{status.current_file}</span>
                  </>
                ) : null}
                {status.current_stage ? <em> ({status.current_stage})</em> : null}
              </>
            ) : (
              <>
                {status.status} — checked {total} file{total === 1 ? '' : 's'} in the folder,{' '}
                <strong>
                  indexed {status.indexed_documents}
                </strong>
                {status.skipped_documents > 0
                  ? `, ${status.skipped_documents} already up to date`
                  : ''}
              </>
            )}
          </p>

          <dl className="index-counters">
            <Counter label="Passages" value={status.total_chunks} highlight={running} />
            <Counter label="Indexed" value={status.indexed_documents} />
            <Counter
              label="Unchanged"
              value={status.skipped_documents}
              hint="Already indexed and not modified since, including duplicate copies of a file"
            />
            <Counter label="Unsupported" value={status.unsupported_documents} />
            <Counter label="Failed" value={status.failed_documents} tone={status.failed_documents ? 'bad' : undefined} />
            <Counter label="Removed" value={status.deleted_documents} />
            <div>
              <dt>Started by</dt>
              <dd>{status.trigger === 'upload' ? 'import' : 'folder scan'}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="hint empty">No job has run in this session yet.</p>
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
      <DeviceStatus />
    </section>
  )
}

function Counter({
  label,
  value,
  highlight = false,
  tone,
  hint,
}: {
  label: string
  value: number
  highlight?: boolean
  tone?: string
  hint?: string
}) {
  return (
    <div className={`counter${highlight ? ' live' : ''}${tone ? ` ${tone}` : ''}`} title={hint}>
      <dt>{label}</dt>
      <dd>
        <CountUp value={value} />
      </dd>
    </div>
  )
}
