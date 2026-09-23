// frontend/src/components/AddDocumentsCard.tsx
import { CloseOutlined } from '@ant-design/icons'
import { Button, Card, Collapse, Divider, Typography } from 'antd'
import type { Library } from '../hooks/useLibrary'
import { FolderPanel } from './FolderPanel'
import { ImportPanel } from './ImportPanel'
import { JobHistory } from './JobHistory'
import { JobProgress } from './JobProgress'

/**
 * Everything the old Indexing tab did, in the card that opens when the aggregation
 * cards minimise: register a folder, import files, start a job, and watch it run.
 */
export function AddDocumentsCard({ library, onClose }: { library: Library; onClose: () => void }) {
  const running = library.status?.status === 'running'

  return (
    <Card
      title="Add documents"
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
      <Typography.Title level={5}>Folders</Typography.Title>
      <FolderPanel
        folders={library.folders}
        busy={library.busy}
        running={running}
        onAdd={library.addLibraryFolder}
        onRemove={(path) => void library.removeLibraryFolder(path)}
      />

      <Divider />

      <Typography.Title level={5}>Import files</Typography.Title>
      <ImportPanel
        busy={library.busy}
        running={running}
        lastUpload={library.lastUpload}
        onImport={library.importFiles}
      />

      <Divider />

      <Typography.Title level={5}>Indexing</Typography.Title>
      <JobProgress
        status={library.status}
        busy={library.busy}
        onIndex={() => void library.runIndexing()}
      />

      <Collapse
        ghost
        size="small"
        className="job-history"
        items={[
          { key: 'jobs', label: 'Recent jobs', children: <JobHistory jobs={library.jobs} /> },
        ]}
      />
    </Card>
  )
}
