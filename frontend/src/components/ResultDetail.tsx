// frontend/src/components/ResultDetail.tsx
import { DownloadOutlined, ExportOutlined, PartitionOutlined } from '@ant-design/icons'
import { Button, Descriptions, Empty, Progress, Space, Tag, Typography } from 'antd'
import { Link } from 'react-router-dom'
import { documentFileUrl, type SearchHit } from '../services/api'
import { useSettings } from '../settings/SettingsContext'
import { highlight, pageLabel, withoutRepeatedHeading } from './passage'

/** Everything about one result: the whole passage, every field, and the way in. */
export function ResultDetail({ hit, query }: { hit: SearchHit | null; query?: string }) {
  const { settings } = useSettings()

  if (!hit) {
    return (
      <Empty
        className="detail-empty"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="Select a result to see the whole passage"
      />
    )
  }

  const body = withoutRepeatedHeading(hit.text, hit.heading)
  const score = Math.max(0, Math.min(1, hit.score))

  return (
    <div className="result-detail">
      <Space align="start" size="middle" className="detail-head">
        <Progress
          type="circle"
          size={56}
          percent={Math.round(score * 100)}
          format={() => score.toFixed(2)}
          aria-label={`Relevance ${score.toFixed(3)}`}
        />
        <div>
          <Typography.Title level={5} className="detail-file">
            {hit.filename}
          </Typography.Title>
          <Space size={4} wrap>
            <Tag>{pageLabel(hit)}</Tag>
            {hit.language ? <Tag>{hit.language}</Tag> : null}
            <Tag>{hit.file_type === 'docx' ? 'Word' : 'PDF'}</Tag>
          </Space>
        </div>
      </Space>

      {hit.heading ? (
        <Typography.Text strong className="detail-heading">
          {hit.heading}
        </Typography.Text>
      ) : null}

      {/* The passage is what the reader came for, so it gets the room, unclipped. */}
      <div className="detail-text">{highlight(body, query, settings.highlightTerms)}</div>

      <Space wrap className="detail-actions">
        {hit.file_type === 'docx' ? (
          // Browsers cannot show a .docx, so it downloads and opens in Word.
          <Button
            type="primary"
            icon={<DownloadOutlined aria-hidden="true" />}
            href={documentFileUrl(hit.document_id)}
            download
          >
            Download the Word file
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<ExportOutlined aria-hidden="true" />}
            href={documentFileUrl(hit.document_id, hit.page_start)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open {pageLabel(hit).toLowerCase()} in the PDF
          </Button>
        )}

        {settings.showAdminLinks ? (
          <Link to={`/admin?document=${hit.document_id}&chunk=${hit.chunk_index}&tab=passages`}>
            <Button icon={<PartitionOutlined aria-hidden="true" />}>Inspect passages</Button>
          </Link>
        ) : null}
      </Space>

      <Descriptions
        size="small"
        column={1}
        className="detail-fields"
        items={[
          { key: 'score', label: 'Relevance', children: hit.score.toFixed(4) },
          { key: 'pages', label: 'Page', children: pageLabel(hit) },
          { key: 'chunk', label: 'Passage number', children: `#${hit.chunk_index}` },
          { key: 'language', label: 'Language', children: hit.language ?? 'not detected' },
          {
            key: 'path',
            label: 'File',
            children: <Typography.Text copyable className="detail-path">{hit.filepath}</Typography.Text>,
          },
          // The document id is an internal hash. It identifies nothing the reader can
          // act on, so it stays out of the panel; the admin page still shows it.
        ]}
      />
    </div>
  )
}
