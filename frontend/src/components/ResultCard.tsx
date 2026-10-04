// frontend/src/components/ResultCard.tsx
import { FilePdfOutlined, FileWordOutlined } from '@ant-design/icons'
import { Tag, Typography } from 'antd'
import { memo, type KeyboardEvent } from 'react'
import { keyOf } from '../app/resultKey'
import type { SearchHit } from '../services/api'
import { CARD_MAX_HEIGHT } from '../settings/settings'
import { useSettings } from '../settings/SettingsContext'
import { RELEVANCE_LABEL, highlight, pageLabel, passageBody, relevanceBand } from './passage'

interface Props {
  hit: SearchHit
  query?: string
  selected: boolean
  /** Stable across renders (the context's select), so memo can skip unchanged cards. */
  onSelect: (hit: SearchHit) => void
  /** The [n] the answer cites this result as, when it does. */
  citation?: number
}

/**
 * One result, laid out like a web search result: where it is, what section it is, and
 * the passage itself. The score stays out of the way; the colour of the highlights and
 * a quiet label carry how close the match is. The full passage belongs in the detail
 * panel, so the item is bounded in height (spec R3.3) and never expands.
 */
export const ResultCard = memo(function ResultCard({
  hit,
  query,
  selected,
  onSelect,
  citation,
}: Props) {
  const { settings } = useSettings()
  const band = relevanceBand(hit.score)
  const FileIcon = hit.file_type === 'docx' ? FileWordOutlined : FilePdfOutlined

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(hit)
    }
  }

  return (
    <div
      className={`result-card relevance-${band}${selected ? ' selected' : ''}`}
      style={{ maxHeight: CARD_MAX_HEIGHT[settings.previewLines] }}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onSelect(hit)}
      onKeyDown={keyDown}
      data-testid="result-card"
      data-result-key={keyOf(hit)}
    >
      <div className="result-source">
        <FileIcon aria-hidden="true" className="result-source-icon" />
        <Typography.Text ellipsis={{ tooltip: hit.filename }} className="result-file">
          {hit.filename}
        </Typography.Text>
        <span className="result-source-sep" aria-hidden="true">
          ·
        </span>
        <span className="result-page">{pageLabel(hit)}</span>
        {hit.visibility === 'public' ? (
          <Tag color="blue" bordered={false} className="result-tag">
            Public
          </Tag>
        ) : null}
        {settings.developerMode && hit.language ? (
          <Tag bordered={false} className="result-tag">
            {hit.language}
          </Tag>
        ) : null}
        {settings.developerMode && hit.owner_username ? (
          <Tag bordered={false} className="result-tag">
            {hit.owner_username}
          </Tag>
        ) : null}
        <span className="result-relevance" title={`Relevance ${hit.score.toFixed(3)}`}>
          <span className="relevance-dot" aria-hidden="true" />
          {RELEVANCE_LABEL[band]}
        </span>
      </div>

      <div className="result-title">
        {citation !== undefined ? (
          <span className="result-cite" title={`Cited in the answer as [${citation}]`}>
            [{citation}]
          </span>
        ) : null}
        {highlight(hit.heading || hit.filename, query, settings.highlightTerms)}
      </div>

      <p className="result-text clamp" style={{ WebkitLineClamp: settings.previewLines }}>
        {highlight(passageBody(hit), query, settings.highlightTerms)}
      </p>
    </div>
  )
})
