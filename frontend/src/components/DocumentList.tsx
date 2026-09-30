// frontend/src/components/DocumentList.tsx
import { DownloadOutlined, ExportOutlined } from '@ant-design/icons'
import { Button, Empty, Popconfirm, Space, Table, Tag, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useState } from 'react'
import { documentFileUrl, type DocumentSummary, type Visibility } from '../services/api'
import { VisibilitySwitch, VisibilityTag } from './VisibilityTag'

interface Props {
  documents: DocumentSummary[]
  busy?: boolean
  /** Offered only on documents the viewer may remove: their own, or any for an admin. */
  onRemove?: (documentId: string) => void
  /** Admins: owner column, visibility switches and bulk publishing. */
  admin?: boolean
  onVisibility?: (documentIds: string[], visibility: Visibility) => void
  empty?: string
}

const STATUS_TONE: Record<string, string> = {
  indexed: 'success',
  skipped: 'default',
  unsupported: 'warning',
  failed: 'error',
}

export function DocumentList({
  documents,
  busy = false,
  onRemove,
  admin = false,
  onVisibility,
  empty = 'No documents indexed yet. Import files above, then index.',
}: Props) {
  const [selected, setSelected] = useState<string[]>([])

  if (documents.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} />
  }

  const canRemove = (document: DocumentSummary) => admin || !!document.is_mine
  const owners = Array.from(
    new Set(documents.map((document) => document.owner_username ?? 'Library')),
  ).sort()

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
          {document.filepath ? (
            <Typography.Text type="secondary" className="doc-path" title={document.filepath}>
              {document.filepath}
            </Typography.Text>
          ) : null}
        </div>
      ),
    },
    ...(admin
      ? [
          {
            title: 'Owner',
            key: 'owner',
            filters: owners.map((owner) => ({ text: owner, value: owner })),
            onFilter: (value: boolean | React.Key, document: DocumentSummary) =>
              (document.owner_username ?? 'Library') === value,
            sorter: (left: DocumentSummary, right: DocumentSummary) =>
              (left.owner_username ?? '').localeCompare(right.owner_username ?? ''),
            render: (_: unknown, document: DocumentSummary) =>
              document.owner_username ? (
                <Typography.Text>{document.owner_username}</Typography.Text>
              ) : (
                <Tag>Library</Tag>
              ),
          },
        ]
      : []),
    {
      title: 'Visibility',
      key: 'visibility',
      filters: [
        { text: 'Public', value: 'public' },
        { text: 'Private', value: 'private' },
      ],
      onFilter: (value, document) => (document.visibility ?? 'private') === value,
      render: (_: unknown, document: DocumentSummary) =>
        admin && onVisibility ? (
          <VisibilitySwitch
            filename={document.filename}
            visibility={document.visibility}
            disabled={busy}
            onChange={(visibility) => onVisibility([document.document_id], visibility)}
          />
        ) : (
          <VisibilityTag visibility={document.visibility} />
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
      render: (_: unknown, document: DocumentSummary) =>
        canRemove(document) ? (
          <Popconfirm
            title="Remove from the index?"
            description={
              document.owner_id === 'library'
                ? 'The file stays in its folder, so the next job picks it up again.'
                : 'The uploaded file is deleted too.'
            }
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
        ) : null,
    })
  }

  const bulk = admin && onVisibility
  return (
    <>
      {bulk ? (
        <Space className="bulk-actions" wrap>
          <Typography.Text type="secondary">
            {selected.length > 0 ? `${selected.length} selected` : 'Select documents to publish them together'}
          </Typography.Text>
          <Button
            size="small"
            disabled={busy || selected.length === 0}
            onClick={() => {
              onVisibility(selected, 'public')
              setSelected([])
            }}
          >
            Make public
          </Button>
          <Button
            size="small"
            disabled={busy || selected.length === 0}
            onClick={() => {
              onVisibility(selected, 'private')
              setSelected([])
            }}
          >
            Make private
          </Button>
        </Space>
      ) : null}
      <Table
        size="small"
        rowKey="document_id"
        columns={columns}
        dataSource={documents}
        rowSelection={
          bulk
            ? {
                selectedRowKeys: selected,
                onChange: (keys) => setSelected(keys.map(String)),
              }
            : undefined
        }
        pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 25, 50, 100] }}
        scroll={{ x: 'max-content' }}
      />
    </>
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
