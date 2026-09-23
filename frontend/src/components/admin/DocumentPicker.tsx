// frontend/src/components/admin/DocumentPicker.tsx
import { Select, Space, Tag, Typography } from 'antd'
import type { DocumentSummary } from '../../services/api'

/** Shared by the extraction and passage panels, so switching tab keeps the document. */
export function DocumentPicker({
  documents,
  value,
  onChange,
}: {
  documents: DocumentSummary[]
  value: string | null
  onChange: (documentId: string) => void
}) {
  return (
    <Space className="document-picker" wrap>
      <Typography.Text>Document</Typography.Text>
      <Select
        showSearch
        aria-label="Document"
        placeholder="Choose a document"
        value={value ?? undefined}
        onChange={onChange}
        style={{ minWidth: 340 }}
        optionFilterProp="label"
        options={documents.map((document) => ({
          value: document.document_id,
          label: document.filename,
          document,
        }))}
        optionRender={(option) => (
          <Space>
            <span>{option.data.document.filename}</span>
            <Tag>{option.data.document.status}</Tag>
          </Space>
        )}
      />
      {documents.length === 0 ? (
        <Typography.Text type="secondary">Nothing is indexed yet.</Typography.Text>
      ) : null}
    </Space>
  )
}
