// frontend/src/components/ResultDetail.tsx
import { DownloadOutlined, ExportOutlined, PartitionOutlined } from '@ant-design/icons'
import { Button, Descriptions, Progress, Space, Tag, Tooltip, Typography, theme } from 'antd'
import { Link } from 'react-router-dom'
import { useAuth } from '../app/AuthContext'
import { documentFileUrl, type SearchHit } from '../services/api'
import { useSettings } from '../settings/SettingsContext'
import { RELEVANCE_LABEL, highlight, pageLabel, passageBody, relevanceBand, type RelevanceBand } from './passage'

/**
 * Everything about one result: the whole passage and the way into the document. The
 * filename is the panel's title, so it is not repeated here; page and relevance each
 * appear once; the bookkeeping fields only in developer mode.
 */
export function ResultDetail({ hit, query }: { hit: SearchHit; query?: string }) {
  const { settings } = useSettings()
  const { isAdmin } = useAuth()
  const { token } = theme.useToken()
  // The same colours as the --relevance-* variables, from the theme so dark mode follows.
  const ringColour: Record<RelevanceBand, string> = {
    strong: token.colorSuccess,
    good: token.colorWarning,
    weak: token.colorTextQuaternary,
  }

  const score = Math.max(0, Math.min(1, hit.score))
  const band = relevanceBand(hit.score)

  return (
    <div className={`result-detail relevance-${band}`}>
      <div className="detail-head">
        <Space size={4} wrap>
          <Tag>{pageLabel(hit)}</Tag>
          <Tag>{hit.file_type === 'docx' ? 'Word' : 'PDF'}</Tag>
          {hit.visibility === 'public' ? <Tag color="blue">Public</Tag> : null}
        </Space>

        {/* Quiet on purpose: the passage is what the reader came for, not the score. */}
        <Tooltip title={`Cosine similarity ${hit.score.toFixed(4)}, higher is closer in meaning`}>
          <div className="detail-relevance" aria-label={`Relevance ${hit.score.toFixed(3)}`}>
            <Progress
              type="circle"
              size={30}
              strokeWidth={8}
              percent={Math.round(score * 100)}
              format={() => null}
              strokeColor={ringColour[band]}
              className="detail-relevance-ring"
            />
            <span>
              {RELEVANCE_LABEL[band]} · {score.toFixed(2)}
            </span>
          </div>
        </Tooltip>
      </div>

      {hit.heading ? (
        <Typography.Text strong className="detail-heading">
          {highlight(hit.heading, query, settings.highlightTerms)}
        </Typography.Text>
      ) : null}

      {/* The passage gets the room, unclipped. */}
      <div className="detail-text">
        {highlight(passageBody(hit), query, settings.highlightTerms)}
      </div>

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
            Open in the PDF
          </Button>
        )}

        {isAdmin && settings.showAdminLinks ? (
          <Link to={`/admin?document=${hit.document_id}&chunk=${hit.chunk_index}&tab=passages`}>
            <Button icon={<PartitionOutlined aria-hidden="true" />}>Inspect passages</Button>
          </Link>
        ) : null}
      </Space>

      {settings.developerMode ? (
        <Descriptions
          size="small"
          column={1}
          className="detail-fields"
          title="Developer"
          items={[
            { key: 'chunk', label: 'Passage number', children: `#${hit.chunk_index}` },
            { key: 'language', label: 'Language', children: hit.language ?? 'not detected' },
            isAdmin
              ? { key: 'owner', label: 'Owner', children: hit.owner_username ?? 'Library' }
              : {
                  key: 'whose',
                  label: 'Whose',
                  children: hit.is_mine ? 'Yours' : 'Shared with everyone',
                },
            // Another user's public document does not reveal where it is stored.
            ...(hit.filepath
              ? [
                  {
                    key: 'path',
                    label: 'File',
                    children: (
                      <Typography.Text copyable className="detail-path">
                        {hit.filepath}
                      </Typography.Text>
                    ),
                  },
                ]
              : []),
          ]}
        />
      ) : null}
    </div>
  )
}
