// frontend/src/components/ResultDetail.tsx
// The result panel (spec 2026-10-08 §2.1): the document itself, scrolled to the passage
// and with it highlighted. The passage as text is only the fallback for a file the
// browser cannot show; the bookkeeping fields appear in developer mode, under it.
import { PartitionOutlined } from '@ant-design/icons'
import { Button, Descriptions, Typography } from 'antd'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../app/AuthContext'
import type { SearchHit } from '../services/api'
import { useSettings } from '../settings/SettingsContext'
import { DocumentViewer } from '../viewer/DocumentViewer'
import { highlight, passageBody } from './passage'

export function ResultDetail({ hit, query }: { hit: SearchHit; query?: string }) {
  const target = useMemo(
    () => ({ text: passageBody(hit), pageStart: hit.page_start, pageEnd: hit.page_end }),
    [hit],
  )
  return (
    <div className="result-detail">
      <DocumentViewer
        // One viewer per document: another passage of the same file only moves the
        // highlight, without downloading the file again.
        key={hit.document_id}
        documentId={hit.document_id}
        target={target}
        query={query}
        filename={hit.filename}
        chunkIndex={hit.chunk_index}
        variant="panel"
        fallback={<ResultPassage hit={hit} query={query} />}
      />
      <ResultFooter hit={hit} />
    </div>
  )
}

/** The passage as text, for when the file itself cannot be shown. */
export function ResultPassage({ hit, query }: { hit: SearchHit; query?: string }) {
  const { settings } = useSettings()
  return (
    <div className="result-passage">
      {hit.heading ? (
        <Typography.Text strong className="detail-heading">
          {highlight(hit.heading, query, settings.highlightTerms)}
        </Typography.Text>
      ) : null}
      <div className="detail-text">{highlight(passageBody(hit), query, settings.highlightTerms)}</div>
    </div>
  )
}

/** Developer fields and the admin's way into the passage inspector, when asked for. */
function ResultFooter({ hit }: { hit: SearchHit }) {
  const { settings } = useSettings()
  const { isAdmin } = useAuth()
  const inspect = isAdmin && settings.showAdminLinks
  if (!settings.developerMode && !inspect) return null
  return (
    <div className="result-footer">
      {inspect ? (
        <Link to={`/admin?document=${hit.document_id}&chunk=${hit.chunk_index}&tab=passages`}>
          <Button size="small" icon={<PartitionOutlined aria-hidden="true" />}>
            Inspect passages
          </Button>
        </Link>
      ) : null}
      {settings.developerMode ? (
        <Descriptions
          size="small"
          column={1}
          className="detail-fields"
          title="Developer"
          items={[
            { key: 'chunk', label: 'Passage number', children: `#${hit.chunk_index}` },
            {
              key: 'score',
              label: 'Relevance',
              children: `${hit.score.toFixed(4)} (cosine similarity)`,
            },
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
