// frontend/src/components/DocumentList.tsx
import { DownloadOutlined, ExportOutlined } from '@ant-design/icons'
import { Button, Empty, Popconfirm, Space, Table, Tag, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { documentFileUrl, type DocumentSummary } from '../services/api'

interface Props {
  documents: DocumentSummary[]
  busy?: boolean
  onRemove?: (documentId: string) => void
}

const STATUS_TONE: Record<string, string> = {
  indexed: 'success',
  skipped: 'default',
  unsupported: 'warning',
  failed: 'error',
}

export function DocumentList({ documents, busy = false, onRemove }: Props) {
  if (documents.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="No documents indexed yet. Add a folder or import files above, then index."
      />
    )
  }

  const columns: ColumnsType<DocumentSummary> = [
    {
      title: 'File',
      dataIndex: 'filename',
      sorter: (left, right) => left.filename.localeCompare(right.filename),
      defaultSortOrder: 'ascend',
      render: (_: string, document: DocumentSummary) => (
        <div className="doc-cell">
          <Space size={4} wrap>
            {document.status === 'failed' ? (
              <Typography.Text>{document.filename}</Typography.Text>
            ) : (
              <Typography.Link
                href={documentFileUrl(document.document_id)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {document.filename}{' '}
                {document.file_type === 'docx' ? <DownloadOutlined /> : <ExportOutlined />}
              </Typography.Link>
            )}
            {document.file_type === 'docx' ? <Tag>DOCX</Tag> : null}
          </Space>
          {document.title ? (
            <Typography.Text type="secondary" className="doc-title">
              {document.title}
            </Typography.Text>
          ) : null}
          {document.error_message ? (
            <Typography.Text type="danger" className="doc-error">
              {document.error_message}
            </Typography.Text>
          ) : null}
          {document.alt_filepaths.length > 0 ? (
            <Typography.Text type="secondary" className="doc-title">
              also at {document.alt_filepaths.length} other path
              {document.alt_filepaths.length === 1 ? '' : 's'}
            </Typography.Text>
          ) : null}
          <Typography.Text type="secondary" className="doc-path" title={document.filepath}>
            {document.filepath}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: 'Size',
      dataIndex: 'file_size',
      align: 'right',
      sorter: (left, right) => left.file_size - right.file_size,
      render: (bytes: number) => formatSize(bytes),
    },
    {
      title: 'Pages',
      dataIndex: 'pages',
      align: 'right',
      sorter: (left, right) => left.pages - right.pages,
      render: (pages: number, document: DocumentSummary) =>
        document.pages_approximate ? (
          <Tooltip title="Approximate: a Word file has no fixed pages">~{pages}</Tooltip>
        ) : (
          pages
        ),
    },
    {
      title: 'Passages',
      dataIndex: 'chunks',
      align: 'right',
      sorter: (left, right) => left.chunks - right.chunks,
    },
    {
      title: 'Language',
      dataIndex: 'language',
      render: (language: string | null) => language ?? '—',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      sorter: (left, right) => left.status.localeCompare(right.status),
      render: (status: string) => <Tag color={STATUS_TONE[status] ?? 'default'}>{status}</Tag>,
    },
    {
      title: 'Indexed',
      dataIndex: 'indexed_at',
      sorter: (left, right) => String(left.indexed_at).localeCompare(String(right.indexed_at)),
      render: (iso: string | null) => formatTime(iso),
    },
  ]

  if (onRemove) {
    columns.push({
      title: 'Action',
      key: 'action',
      render: (_: unknown, document: DocumentSummary) => (
        <Popconfirm
          title="Remove from the index?"
          description="The file stays in its folder, so the next job picks it up again."
          okText="Remove"
          okButtonProps={{ danger: true }}
          onConfirm={() => onRemove(document.document_id)}
          disabled={busy}
        >
          <Button
            type="text"
            danger
            size="small"
            disabled={busy}
            aria-label={`Remove ${document.filename} from the index`}
          >
            Remove
          </Button>
        </Popconfirm>
      ),
    })
  }

  return (
    <Table
      size="small"
      rowKey="document_id"
      columns={columns}
      dataSource={documents}
      pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 25, 50, 100] }}
      scroll={{ x: 'max-content' }}
    />
  )
}

function formatSize(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(iso?: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}
