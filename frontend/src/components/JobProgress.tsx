// frontend/src/components/JobProgress.tsx
import { PlayCircleOutlined } from '@ant-design/icons'
import { Alert, Button, Col, Progress, Row, Space, Statistic, Tag, Typography } from 'antd'
import type { IndexStatus } from '../services/api'
import { CountUp } from './CountUp'
import { DeviceStatus } from './DeviceStatus'
import { DeviceUsageMeter } from './DeviceUsageMeter'

interface Props {
  status: IndexStatus | null
  busy: boolean
  onIndex: () => void
}

const TONE: Record<string, string> = {
  running: 'processing',
  completed: 'success',
  failed: 'error',
  idle: 'default',
}

export function JobProgress({ status, busy, onIndex }: Props) {
  const running = status?.status === 'running'
  const total = status?.total_documents ?? 0
  const processed = status?.processed_documents ?? 0
  const withinFile = status?.current_file_progress ?? 0

  // Counting the part-finished file makes the bar move while one long document is being
  // embedded, instead of standing still between whole files.
  const fraction = total > 0 ? Math.min(1, (processed + withinFile) / total) : 0
  const percent = Math.round(fraction * 100)
  // Before discovery finishes there is no total, so nothing sensible can be shown yet.
  const indeterminate = running && total === 0

  return (
    <div className="job-progress">
      <Space wrap className="index-actions">
        <Button
          type="primary"
          icon={<PlayCircleOutlined aria-hidden="true" />}
          loading={running}
          disabled={running || busy}
          onClick={onIndex}
        >
          {running ? 'Indexing…' : 'Index documents'}
        </Button>
        {status && status.status !== 'idle' ? (
          <Tag color={TONE[status.status] ?? 'default'}>{status.status}</Tag>
        ) : null}
        {status?.directory ? <code className="index-dir">{status.directory}</code> : null}
      </Space>

      {status && status.status !== 'idle' ? (
        <>
          <Progress
            percent={running ? percent : 100}
            status={
              status.status === 'failed' ? 'exception' : running ? 'active' : 'success'
            }
            format={() => (indeterminate ? 'scanning…' : running ? `${percent}%` : 'done')}
            aria-label="Indexing progress"
          />

          {/* Live while the job runs: the backend only samples the device then. */}
          <DeviceUsageMeter usage={status.device} />

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

          <Row gutter={[16, 8]} className="index-counters">
            <Col xs={8} md={4}>
              <Statistic
                title="Passages"
                valueRender={() => <CountUp value={status.total_chunks} />}
              />
            </Col>
            <Col xs={8} md={4}>
              <Statistic
                title="Indexed"
                valueRender={() => <CountUp value={status.indexed_documents} />}
              />
            </Col>
            <Col xs={8} md={4}>
              <Statistic
                title="Unchanged"
                valueRender={() => <CountUp value={status.skipped_documents} />}
              />
            </Col>
            <Col xs={8} md={4}>
              <Statistic
                title="Unsupported"
                valueRender={() => <CountUp value={status.unsupported_documents} />}
              />
            </Col>
            <Col xs={8} md={4}>
              <Statistic
                title="Failed"
                valueRender={() => <CountUp value={status.failed_documents} />}
                valueStyle={status.failed_documents ? { color: 'var(--error)' } : undefined}
              />
            </Col>
            <Col xs={8} md={4}>
              <Statistic
                title="Removed"
                valueRender={() => <CountUp value={status.deleted_documents} />}
              />
            </Col>
          </Row>
        </>
      ) : (
        <Typography.Text type="secondary">No job has run in this session yet.</Typography.Text>
      )}

      {status && status.failures.length > 0 ? (
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

      {running ? null : <DeviceStatus />}
    </div>
  )
}
