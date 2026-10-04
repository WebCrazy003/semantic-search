// frontend/src/components/AddDocumentsCard.tsx
import { CloseOutlined } from '@ant-design/icons'
import { Button, Card, Divider, Typography } from 'antd'
import { useState } from 'react'
import type { Library } from '../hooks/useLibrary'
import { ImportPanel } from './ImportPanel'
import { JobProgress } from './JobProgress'

/**
 * The card that opens when the aggregation cards minimise: import files, which starts
 * the indexing job, then watch it run. Files are imported into the documents folder
 * rather than indexed from wherever they sit, so there is one place documents live.
 */
export function AddDocumentsCard({ library, onClose }: { library: Library; onClose: () => void }) {
  const running = library.status?.status === 'running'
  // A job that had already finished when the card opened is not this card's to report;
  // one still running then, or any started since, is, through to its outcome.
  const [atOpen] = useState(() => ({ jobId: library.status?.job_id ?? null, running }))
  const jobId = library.status?.job_id ?? null
  const showJob = running || (jobId !== null && (jobId !== atOpen.jobId || atOpen.running))

  return (
    <Card
      title="Import & index files"
      className="add-documents-card"
      data-testid="add-documents-card"
      extra={
        <Button
          type="text"
          shape="circle"
          icon={<CloseOutlined aria-hidden="true" />}
          aria-label="Close add documents"
          onClick={onClose}
        />
      }
    >
      <ImportPanel
        busy={library.busy}
        running={running}
        lastUpload={library.lastUpload}
        onImport={library.importFiles}
      />

      {showJob ? (
        <>
          <Divider />
          <Typography.Title level={5}>{running ? 'Indexing' : 'Indexing finished'}</Typography.Title>
          <JobProgress status={library.status} />
        </>
      ) : null}
    </Card>
  )
}
