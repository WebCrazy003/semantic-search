// frontend/src/components/admin/PassagesPanel.tsx
import { Alert, Card, Empty, Pagination, Skeleton, Space, Statistic, Tag, Tooltip, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { getChunks, type ChunkListResponse, type ChunkView, type DocumentSummary } from '../../services/api'
import { DocumentPicker } from './DocumentPicker'

const LIMIT = 25

/** How each passage was cut, and where it repeats the end of the one before it. */
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!documentId) return
    let live = true
    setBusy(true)
    setError(null)
    getChunks(documentId, offset, LIMIT)
      .then((result) => {
        if (live) setData(result)
      })
      .catch((caught: unknown) => {
        if (!live) return
        setData(null)
        setError(caught instanceof Error ? caught.message : 'Could not read the passages')
      })
      .finally(() => {
        if (live) setBusy(false)
      })
    return () => {
      live = false
    }
  }, [documentId, offset])

  // A link from a search result names the passage it came from, so scroll to it.
  useEffect(() => {
    if (focusChunk === null || !data) return
    const target = listRef.current?.querySelector<HTMLElement>(`[data-chunk="${focusChunk}"]`)
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusChunk, data])

  return (
    <div className="admin-panel">
      <Typography.Paragraph type="secondary">
        A document is split into overlapping passages, and each passage is what gets embedded and
        returned by a search. The tinted text at the start of a passage is repeated from the end of
        the previous one, so a sentence that straddles a boundary can still be found.
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

          <div className="passage-list" ref={listRef}>
            {data.chunks.map((chunk) => (
              <PassageCard
                key={chunk.chunk_index}
                chunk={chunk}
                focused={focusChunk === chunk.chunk_index}
              />
            ))}
          </div>

          <Pagination
            current={Math.floor(offset / LIMIT) + 1}
            pageSize={LIMIT}
            total={data.total_chunks}
            showSizeChanger={false}
            onChange={(page) => setOffset((page - 1) * LIMIT)}
          />
        </>
      ) : null}
    </div>
  )
}

function PassageCard({ chunk, focused }: { chunk: ChunkView; focused: boolean }) {
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
      data-chunk={chunk.chunk_index}
      className={`passage-card${focused ? ' focused' : ''}`}
      title={
        <Space size={4} wrap>
          <Typography.Text strong>#{chunk.chunk_index}</Typography.Text>
          <Tag>
            {chunk.page_start === chunk.page_end
              ? `Page ${chunk.page_start}`
              : `Pages ${chunk.page_start}–${chunk.page_end}`}
          </Tag>
          {chunk.token_count ? <Tag>{chunk.token_count} tokens</Tag> : null}
          {chunk.kind ? <Tag>{chunk.kind}</Tag> : null}
          <Typography.Text type="secondary">{chunk.char_count} characters</Typography.Text>
        </Space>
      }
    >
      {chunk.heading ? (
        <Typography.Text strong className="passage-heading">
          {chunk.heading}
        </Typography.Text>
      ) : null}
      <p className="passage-text">
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
