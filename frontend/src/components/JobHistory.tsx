// frontend/src/components/JobHistory.tsx
import { usePagination } from '../hooks/usePagination'
import type { JobSummary } from '../services/api'
import { Pagination } from './Pagination'
import { StatusBadge } from './StatusBadge'

interface Props {
  jobs: JobSummary[]
}

export function JobHistory({ jobs }: Props) {
  const paged = usePagination(jobs, 10)

  return (
    <section className="panel">
      <h2>Job history</h2>
      {jobs.length === 0 ? (
        <p className="hint empty">No jobs have run yet.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="jobs">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Trigger</th>
                  <th>State</th>
                  <th className="numeric">Checked</th>
                  <th className="numeric">Indexed</th>
                  <th className="numeric">Unchanged</th>
                  <th className="numeric">Unsupported</th>
                  <th className="numeric">Failed</th>
                  <th className="numeric">Removed</th>
                  <th className="numeric">Passages</th>
                  <th className="numeric">Duration</th>
                </tr>
              </thead>
              <tbody>
                {paged.items.map((job) => (
                  <tr key={job.job_id}>
                    <td>{formatTime(job.started_at)}</td>
                    <td>
                      <span className="badge subtle">
                        {job.trigger === 'upload' ? 'import' : 'scan'}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={job.status} pulse={job.status === 'running'} />
                    </td>
                    <td className="numeric">{job.total}</td>
                    <td className="numeric">{job.indexed}</td>
                    <td className="numeric">{job.skipped}</td>
                    <td className="numeric">{job.unsupported}</td>
                    <td className="numeric">{job.failed}</td>
                    <td className="numeric">{job.deleted}</td>
                    <td className="numeric">{job.chunks}</td>
                    <td className="numeric">{formatDuration(job)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination paged={paged} label="jobs" />
        </>
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
