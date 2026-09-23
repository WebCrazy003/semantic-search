// frontend/src/components/ImportPanel.tsx
import { InboxOutlined } from '@ant-design/icons'
import { Alert, Button, Collapse, Typography, Upload } from 'antd'
import type { UploadFile } from 'antd'
import { useState } from 'react'
import type { UploadResult } from '../services/api'

interface Props {
  busy: boolean
  running: boolean
  lastUpload: UploadResult | null
  onImport: (files: File[]) => void
}

const ACCEPTED = [
  'application/pdf',
  '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.docx',
].join(',')

export function ImportPanel({ busy, running, lastUpload, onImport }: Props) {
  const [chosen, setChosen] = useState<UploadFile[]>([])
  const blocked = busy || running

  function submit() {
    const files = chosen
      .map((item) => item.originFileObj as File | undefined)
      .filter((file): file is File => !!file)
    onImport(files)
    setChosen([])
  }

  return (
    <div className="import-panel">
      <Upload.Dragger
        multiple
        accept={ACCEPTED}
        fileList={chosen}
        disabled={blocked}
        // The upload goes through our own API call on submit, so antd must not POST
        // anything itself.
        beforeUpload={() => false}
        onChange={(info) => setChosen(info.fileList)}
        onRemove={(file) => setChosen((current) => current.filter((item) => item.uid !== file.uid))}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">Drop PDF or Word files here, or click to choose</p>
        <p className="ant-upload-hint">
          Importing <strong>copies</strong> the files into the documents folder and then indexes
          them. For a folder you already keep documents in, add the folder above instead and
          nothing is copied.
        </p>
      </Upload.Dragger>

      <Button
        type="primary"
        className="import-submit"
        onClick={submit}
        disabled={blocked || chosen.length === 0}
      >
        {chosen.length > 1 ? `Import ${chosen.length} files and index` : 'Import and index'}
      </Button>

      {running ? (
        <Typography.Text type="secondary">
          A job is running. Importing is available again when it finishes.
        </Typography.Text>
      ) : null}

      {lastUpload && lastUpload.saved.length > 0 ? (
        <Alert
          type="success"
          showIcon
          message={`Imported ${lastUpload.saved.length} file${
            lastUpload.saved.length === 1 ? '' : 's'
          }`}
          description={lastUpload.saved.join(', ')}
        />
      ) : null}

      {lastUpload && lastUpload.rejected.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="Some files were not imported"
          description={
            <ul className="rejected">
              {lastUpload.rejected.map((item) => (
                <li key={item.filename}>
                  <strong>{item.filename}</strong>: {item.reason}
                </li>
              ))}
            </ul>
          }
        />
      ) : null}

      <Collapse
        ghost
        size="small"
        items={[
          {
            key: 'limits',
            label: 'Which files can be searched',
            children: (
              <div className="limits-body">
                <Typography.Text strong>Works</Typography.Text>
                <ul>
                  <li>PDFs whose text can be selected and copied in a PDF reader</li>
                  <li>Word documents saved as .docx</li>
                  <li>Chinese, Korean, English, and documents that mix them</li>
                  <li>Tables, which are kept whole with their header row</li>
                  <li>Files up to 200 MB each; several can be imported at once</li>
                </ul>
                <Typography.Text strong>Not supported in this version</Typography.Text>
                <ul>
                  <li>Scanned pages and photographs of pages, where the text is an image</li>
                  <li>Password-protected PDFs and Word files</li>
                  <li>Old Word files (.doc); open them in Word and save as .docx first</li>
                  <li>Damaged files</li>
                </ul>
                <Typography.Text type="secondary">
                  An unsupported file never stops a job. It is imported, listed below with its
                  reason, and everything else still gets indexed.
                </Typography.Text>
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}
