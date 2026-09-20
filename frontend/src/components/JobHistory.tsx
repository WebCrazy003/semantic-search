// frontend/src/components/JobHistory.tsx
import type { JobSummary } from '../services/api'

interface Props {
  jobs: JobSummary[]
}

export function JobHistory({ jobs }: Props) {
  return (
    <section className="panel">
      <h2>Job history</h2>
      {jobs.length === 0 ? (
        <p className="hint">No jobs have run yet.</p>
      ) : (
        <table className="jobs">
          <thead>
            <tr>
              <th>Started</th>
              <th>Trigger</th>
              <th>State</th>
              <th>Files</th>
              <th>Indexed</th>
              <th>Skipped</th>
              <th>Unsupported</th>
              <th>Failed</th>
              <th>Removed</th>
              <th>Passages</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.job_id} className={job.status === 'failed' ? 'row-failed' : undefined}>
                <td>{formatTime(job.started_at)}</td>
                <td>{job.trigger === 'upload' ? 'import' : 'scan'}</td>
                <td>{job.status}</td>
                <td>{job.total}</td>
                <td>{job.indexed}</td>
                <td>{job.skipped}</td>
                <td>{job.unsupported}</td>
                <td>{job.failed}</td>
                <td>{job.deleted}</td>
                <td>{job.chunks}</td>
                <td>{formatDuration(job)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
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
