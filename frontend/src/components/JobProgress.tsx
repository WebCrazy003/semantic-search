// frontend/src/components/JobProgress.tsx
import { Alert, Col, Progress, Row, Statistic, Typography, type ProgressProps } from 'antd'
import type { IndexStatus } from '../services/api'
import { CountUp } from './CountUp'
import { DeviceUsageMeter } from './DeviceUsageMeter'

interface Props {
  status: IndexStatus | null
}

const PROGRESS_STATUS: Record<IndexStatus['status'], ProgressProps['status']> = {
  running: 'active',
  completed: 'success',
  failed: 'exception',
  idle: 'normal',
}

function counters(status: IndexStatus): { title: string; value: number; alarming?: boolean }[] {
  return [
    { title: 'Passages', value: status.total_chunks },
    { title: 'Indexed', value: status.indexed_documents },
    { title: 'Unchanged', value: status.skipped_documents },
    { title: 'Unsupported', value: status.unsupported_documents },
    { title: 'Failed', value: status.failed_documents, alarming: true },
    { title: 'Removed', value: status.deleted_documents },
  ]
}

/**
 * One indexing run: live progress and device load while it runs, the outcome once it
 * ends. Jobs start from importing files, so there is no start button here.
 */
export function JobProgress({ status }: Props) {
  if (!status || status.status === 'idle') return null

  const running = status.status === 'running'
  const total = status.total_documents
  const processed = status.processed_documents
  const withinFile = status.current_file_progress

  // Counting the part-finished file makes the bar move while one long document is being
  // embedded, instead of standing still between whole files.
  const fraction = total > 0 ? Math.min(1, (processed + withinFile) / total) : 0
  const percent = Math.round(fraction * 100)
  // Before discovery finishes there is no total, so nothing sensible can be shown yet.
  const indeterminate = running && total === 0

  return (
    <div className="job-progress">
      <Progress
        percent={running ? percent : 100}
        status={PROGRESS_STATUS[status.status]}
        format={() => (indeterminate ? 'scanning…' : running ? `${percent}%` : 'done')}
        aria-label="Indexing progress"
      />

      <Typography.Paragraph aria-live="polite" className="progress-text">
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
            {status.status} — checked {total} file{total === 1 ? '' : 's'},{' '}
            <strong>indexed {status.indexed_documents}</strong>
            {status.skipped_documents > 0
              ? `, ${status.skipped_documents} already up to date`
              : ''}
          </>
        )}
      </Typography.Paragraph>

      {running ? (
        // Live while the job runs: the backend only samples the device then.
        <DeviceUsageMeter usage={status.device} />
      ) : (
        <Row gutter={[16, 8]} className="index-counters">
          {counters(status).map(({ title, value, alarming }) => (
            <Col xs={8} md={4} key={title}>
              <Statistic
                title={title}
                valueRender={() => <CountUp value={value} />}
                valueStyle={alarming && value ? { color: 'var(--error)' } : undefined}
              />
            </Col>
          ))}
        </Row>
      )}

      {status.failures.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`${status.failures.length} file${
            status.failures.length === 1 ? '' : 's'
          } could not be read`}
          description={
            <ul className="index-failures">
              {status.failures.map((failure) => (
                <li key={failure.filepath}>
                  <strong>{failure.filename}</strong> — {failure.error_type}:{' '}
                  {failure.error_message}
                </li>
              ))}
            </ul>
          }
        />
      ) : null}
    </div>
  )
}
