// frontend/src/components/JobHistory.tsx
import { Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { JobSummary } from '../services/api'

const TONE: Record<string, string> = {
  running: 'processing',
  completed: 'success',
  failed: 'error',
}

const COLUMNS: ColumnsType<JobSummary> = [
  { title: 'Started', dataIndex: 'started_at', render: (value: string) => formatTime(value) },
  {
    title: 'Trigger',
    dataIndex: 'trigger',
    render: (value: string) => <Tag>{value === 'upload' ? 'import' : 'scan'}</Tag>,
  },
  {
    title: 'State',
    dataIndex: 'status',
    render: (value: string) => <Tag color={TONE[value] ?? 'default'}>{value}</Tag>,
  },
  { title: 'Checked', dataIndex: 'total', align: 'right' },
  { title: 'Indexed', dataIndex: 'indexed', align: 'right' },
  { title: 'Unchanged', dataIndex: 'skipped', align: 'right' },
  { title: 'Unsupported', dataIndex: 'unsupported', align: 'right' },
  { title: 'Failed', dataIndex: 'failed', align: 'right' },
  { title: 'Removed', dataIndex: 'deleted', align: 'right' },
  { title: 'Passages', dataIndex: 'chunks', align: 'right' },
  {
    title: 'Duration',
    key: 'duration',
    align: 'right',
    render: (_: unknown, job: JobSummary) => formatDuration(job),
  },
]

export function JobHistory({ jobs }: { jobs: JobSummary[] }) {
  if (jobs.length === 0) {
    return <Typography.Text type="secondary">No jobs have run yet.</Typography.Text>
  }

  return (
    <Table
      size="small"
      rowKey="job_id"
      columns={COLUMNS}
      dataSource={jobs}
      pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
      scroll={{ x: 'max-content' }}
    />
  )
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

function formatDuration(job: JobSummary): string {
  if (!job.finished_at) return '—'
  const ms = new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()
  if (Number.isNaN(ms)) return '—'
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}
