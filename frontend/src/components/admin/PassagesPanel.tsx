// frontend/src/components/admin/PassagesPanel.tsx
import { Alert, Card, Empty, Pagination, Skeleton, Space, Statistic, Table, Tag, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useMemo, useState } from 'react'
import { getChunks, type ChunkListResponse, type ChunkView, type DocumentSummary } from '../../services/api'
import { DocumentPicker } from './DocumentPicker'

const LIMIT = 25

/** How each passage was cut, which page it came from, and what text it holds. */
export function PassagesPanel({
  documents,
  documentId,
  onDocumentChange,
  focusChunk,
}: {
  documents: DocumentSummary[]
  documentId: string | null
  onDocumentChange: (documentId: string) => void
  focusChunk: number | null
}) {
  // The window belongs to a document, so switching document resets it without an effect
  // that would first fetch the wrong window and then correct itself.
  const [paging, setPaging] = useState({ documentId, offset: 0 })
  const offset = paging.documentId === documentId ? paging.offset : 0
  const setOffset = (next: number) => setPaging({ documentId, offset: next })

  const [data, setData] = useState<ChunkListResponse | null>(null)
  const [selected, setSelected] = useState<ChunkView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!documentId) return
    let live = true
    setBusy(true)
    setError(null)
    getChunks(documentId, offset, LIMIT)
      .then((result) => {
        if (!live) return
        setData(result)
        // A link from a search result names the passage it came from; otherwise start
        // at the first one, so the detail panel is never empty beside a full table.
        const wanted = result.chunks.find((chunk) => chunk.chunk_index === focusChunk)
        setSelected(wanted ?? result.chunks[0] ?? null)
      })
      .catch((caught: unknown) => {
        if (!live) return
        setData(null)
        setSelected(null)
        setError(caught instanceof Error ? caught.message : 'Could not read the passages')
      })
      .finally(() => {
        if (live) setBusy(false)
      })
    return () => {
      live = false
    }
  }, [documentId, offset, focusChunk])

  /**
   * Rows carry how many of them share their page, so the page column can span them.
   * Grouping this way keeps one scannable table rather than one table per page.
   */
  const rows = useMemo(() => {
    const chunks = data?.chunks ?? []
    const perPage = new Map<number, number>()
    for (const chunk of chunks) {
      perPage.set(chunk.page_start, (perPage.get(chunk.page_start) ?? 0) + 1)
    }
    let previousPage: number | null = null
    return chunks.map((chunk) => {
      const first = chunk.page_start !== previousPage
      previousPage = chunk.page_start
      return { ...chunk, pageSpan: first ? (perPage.get(chunk.page_start) ?? 1) : 0 }
    })
  }, [data])

  const columns: ColumnsType<(typeof rows)[number]> = [
    {
      title: 'Page',
      dataIndex: 'page_start',
      width: 90,
      onCell: (row) => ({ rowSpan: row.pageSpan }),
      render: (page: number, row) => (
        <div className="page-group-cell">
          <Typography.Text strong>
            {row.page_start === row.page_end ? `Page ${page}` : `Pages ${page}–${row.page_end}`}
          </Typography.Text>
          <Typography.Text type="secondary">
            {row.pageSpan} passage{row.pageSpan === 1 ? '' : 's'}
          </Typography.Text>
        </div>
      ),
    },
    { title: '#', dataIndex: 'chunk_index', width: 60 },
    {
      title: 'Heading',
      dataIndex: 'heading',
      width: 160,
      render: (heading: string | null) =>
        heading ? (
          <Typography.Text ellipsis={{ tooltip: heading }}>{heading}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    { title: 'Tokens', dataIndex: 'token_count', width: 80, align: 'right' },
    { title: 'Characters', dataIndex: 'char_count', width: 96, align: 'right' },
    {
      title: 'Passage',
      dataIndex: 'text',
      render: (text: string) => (
        <Typography.Text ellipsis={{ tooltip: false }} className="passage-preview">
          {text}
        </Typography.Text>
      ),
    },
  ]

  return (
    <div className="admin-panel">
      <Typography.Paragraph type="secondary">
        A document is split into overlapping passages, and each passage is what gets embedded and
        returned by a search. Choose a row to read the whole passage; the tinted text in it is
        repeated from the end of the previous one, so a sentence that straddles a boundary can
        still be found.
      </Typography.Paragraph>

      <DocumentPicker documents={documents} value={documentId} onChange={onDocumentChange} />

      {error ? <Alert type="error" showIcon message={error} className="page-alert" /> : null}

      {!documentId ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Choose a document to inspect" />
      ) : null}

      {busy && !data ? <Skeleton active paragraph={{ rows: 6 }} /> : null}

      {data ? (
        <>
          <Space size="large" wrap className="passage-totals">
            <Statistic title="Passages" value={data.total_chunks} />
            <Statistic title="Tokens on this page" value={data.total_tokens} />
            <Statistic title="Pages covered" value={data.pages_covered} />
          </Space>

          <TokenHistogram chunks={data.chunks} />

          <div className="passage-split">
            <div className="passage-table">
              <Table
                size="small"
                rowKey="chunk_index"
                columns={columns}
                dataSource={rows}
                pagination={false}
                scroll={{ x: 'max-content' }}
                rowClassName={(row) =>
                  row.chunk_index === selected?.chunk_index ? 'passage-row selected' : 'passage-row'
                }
                onRow={(row) => ({
                  onClick: () => setSelected(row),
                  tabIndex: 0,
                  'aria-selected': row.chunk_index === selected?.chunk_index,
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelected(row)
                    }
                  },
                })}
              />

              <Pagination
                className="passage-pagination"
                current={Math.floor(offset / LIMIT) + 1}
                pageSize={LIMIT}
                total={data.total_chunks}
                showSizeChanger={false}
                onChange={(page) => setOffset((page - 1) * LIMIT)}
              />
            </div>

            <PassageDetail chunk={selected} />
          </div>
        </>
      ) : null}
    </div>
  )
}

/** The whole text of one passage, with the repeat from its predecessor marked. */
function PassageDetail({ chunk }: { chunk: ChunkView | null }) {
  if (!chunk) {
    return (
      <Card size="small" className="passage-detail">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Select a passage to read it in full"
        />
      </Card>
    )
  }

  // The repeat does not always start at character zero: with the heading repeated at
  // the top of each passage, it begins just after that heading.
  const start = chunk.overlap_start
  const end = start + chunk.overlap_with_previous
  const before = chunk.text.slice(0, start)
  const overlap = chunk.text.slice(start, end)
  const rest = chunk.text.slice(end)

  return (
    <Card
      size="small"
      className="passage-detail"
      title={
        <Space size={4} wrap>
          <Typography.Text strong>Passage #{chunk.chunk_index}</Typography.Text>
          <Tag>
            {chunk.page_start === chunk.page_end
              ? `Page ${chunk.page_start}`
              : `Pages ${chunk.page_start}–${chunk.page_end}`}
          </Tag>
          {chunk.token_count ? <Tag>{chunk.token_count} tokens</Tag> : null}
          {chunk.kind ? <Tag>{chunk.kind}</Tag> : null}
        </Space>
      }
    >
      {chunk.heading ? (
        <Typography.Text strong className="passage-heading">
          {chunk.heading}
        </Typography.Text>
      ) : null}

      <p className="passage-text" data-chunk={chunk.chunk_index}>
        {before}
        {overlap ? (
          <Tooltip
            title={`${chunk.overlap_with_previous} characters repeated from passage #${
              chunk.chunk_index - 1
            }, so a sentence split across the boundary can still be found`}
          >
            <mark className="overlap">{overlap}</mark>
          </Tooltip>
        ) : null}
        {rest}
      </p>

      <Typography.Text type="secondary" className="passage-foot">
        {chunk.char_count} characters
        {chunk.overlap_with_previous > 0
          ? ` · ${chunk.overlap_with_previous} repeated from the previous passage`
          : null}
      </Typography.Text>
    </Card>
  )
}

/** Token counts at a glance: an over- or under-sized passage stands out immediately. */
function TokenHistogram({ chunks }: { chunks: ChunkView[] }) {
  const values = chunks.map((chunk) => chunk.token_count ?? 0)
  if (values.length === 0 || values.every((value) => value === 0)) return null
  const largest = Math.max(...values)

  return (
    <svg
      className="token-histogram"
      viewBox={`0 0 ${Math.max(values.length * 6, 60)} 40`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Token count of each passage, from ${Math.min(...values)} to ${largest}`}
    >
      <title>Tokens per passage</title>
      {values.map((value, index) => (
        <rect
          key={index}
          x={index * 6}
          y={40 - (value / largest) * 40}
          width={4}
          height={(value / largest) * 40}
          fill="currentColor"
        />
      ))}
    </svg>
  )
}
