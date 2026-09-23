// frontend/src/components/admin/ExtractionPanel.tsx
import { CopyOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Pagination,
  Segmented,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd'
import { useEffect, useState } from 'react'
import { getExtraction, type DocumentSummary, type ExtractionResponse } from '../../services/api'
import { DocumentPicker } from './DocumentPicker'

const PER_PAGE = 5

/**
 * What the extractor gets out of a file, page by page. The text is produced on demand:
 * indexing keeps only the chunked passages, so there is no stored page text to read.
 */
export function ExtractionPanel({
  documents,
  documentId,
  onDocumentChange,
}: {
  documents: DocumentSummary[]
  documentId: string | null
  onDocumentChange: (documentId: string) => void
}) {
  // The page number belongs to a document, so switching document resets it without an
  // effect that would fetch page 5 of the new document before correcting itself.
  const [paging, setPaging] = useState({ documentId, page: 1 })
  const page = paging.documentId === documentId ? paging.page : 1
  const setPage = (next: number) => setPaging({ documentId, page: next })

  const [view, setView] = useState<'text' | 'blocks'>('text')
  const [data, setData] = useState<ExtractionResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!documentId) return
    let live = true
    setBusy(true)
    setError(null)
    getExtraction(documentId, page, PER_PAGE)
      .then((result) => {
        if (live) setData(result)
      })
      .catch((caught: unknown) => {
        if (!live) return
        setData(null)
        setError(caught instanceof Error ? caught.message : 'Could not extract that document')
      })
      .finally(() => {
        if (live) setBusy(false)
      })
    return () => {
      live = false
    }
  }, [documentId, page])

  return (
    <div className="admin-panel">
      <Typography.Paragraph type="secondary">
        The text below is produced by running the extractor again, now — it is not a stored copy.
        Compare it with the original pages to see whether a wrong-looking search result is caused
        by extraction.
      </Typography.Paragraph>

      <DocumentPicker documents={documents} value={documentId} onChange={onDocumentChange} />

      {error ? <Alert type="error" showIcon message={error} className="page-alert" /> : null}

      {!documentId ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Choose a document to inspect" />
      ) : null}

      {busy && !data ? <Skeleton active paragraph={{ rows: 6 }} /> : null}

      {data ? (
        <>
          <Descriptions
            size="small"
            column={{ xs: 1, sm: 2, lg: 4 }}
            className="extraction-meta"
            items={[
              { key: 'file', label: 'File', children: data.filename },
              {
                key: 'type',
                label: 'Type',
                children: data.file_type === 'docx' ? 'Word (.docx)' : 'PDF',
              },
              {
                key: 'pages',
                label: 'Pages',
                children: data.pages_approximate ? `~${data.pages}` : data.pages,
              },
              { key: 'language', label: 'Language', children: data.language ?? 'not detected' },
              { key: 'took', label: 'Extracted in', children: `${data.extracted_ms} ms` },
              { key: 'path', label: 'Path', children: <code>{data.filepath}</code>, span: 3 },
            ]}
          />

          {!data.file_hash_matches_manifest ? (
            <Alert
              type="warning"
              showIcon
              message="This file has changed since it was indexed"
              description="What you see here is the current file. The index still holds the passages from the older version, so index again to make them agree."
            />
          ) : null}

          <Space className="extraction-controls" wrap>
            <Segmented<'text' | 'blocks'>
              value={view}
              onChange={setView}
              options={[
                { label: 'Page text', value: 'text' },
                { label: 'Blocks', value: 'blocks' },
              ]}
            />
            <Pagination
              current={page}
              pageSize={PER_PAGE}
              total={data.pages}
              showSizeChanger={false}
              onChange={setPage}
              showTotal={(total) => `${total} pages`}
            />
          </Space>

          {data.page_views.map((view_page) => (
            <section key={view_page.page_number} className="extracted-page">
              <div className="extracted-page-head">
                <Typography.Text strong>
                  Page {data.pages_approximate ? '~' : ''}
                  {view_page.page_number}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {view_page.char_count.toLocaleString()} characters
                </Typography.Text>
                {view_page.char_count === 0 ? (
                  <Tag color="warning">no extractable text — likely a scanned page</Tag>
                ) : null}
                <Button
                  size="small"
                  type="text"
                  icon={<CopyOutlined aria-hidden="true" />}
                  onClick={() => void navigator.clipboard?.writeText(view_page.text)}
                >
                  Copy page text
                </Button>
              </div>

              {view === 'text' ? (
                <pre className="extracted-text">{view_page.text}</pre>
              ) : (
                <div className="extracted-blocks">
                  {view_page.blocks.map((block, index) => (
                    <div key={index} className="extracted-block">
                      <Tag>{block.kind}</Tag>
                      <pre className="extracted-text">{block.text}</pre>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </>
      ) : null}
    </div>
  )
}
