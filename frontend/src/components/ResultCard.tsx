// frontend/src/components/ResultCard.tsx
import { Card, Progress, Tag, Typography } from 'antd'
import type { KeyboardEvent } from 'react'
import type { SearchHit } from '../services/api'
import { CARD_MAX_HEIGHT } from '../settings/settings'
import { useSettings } from '../settings/SettingsContext'
import { highlight, pageLabel, withoutRepeatedHeading } from './passage'

interface Props {
  hit: SearchHit
  query?: string
  selected: boolean
  onSelect: () => void
}

/**
 * One result, at a bounded height so three cards fit above the fold (spec R3.3). The
 * card is deliberately not expandable: the full passage belongs in the detail panel,
 * where it does not push the next result off the screen.
 */
export function ResultCard({ hit, query, selected, onSelect }: Props) {
  const { settings } = useSettings()
  const body = withoutRepeatedHeading(hit.text, hit.heading)
  const score = Math.max(0, Math.min(1, hit.score))

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect()
    }
  }

  return (
    <Card
      size="small"
      hoverable
      className={`result-card${selected ? ' selected' : ''}`}
      style={{ maxHeight: CARD_MAX_HEIGHT[settings.previewLines] }}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={keyDown}
      data-testid="result-card"
    >
      <div className="result-card-body">
        <Progress
          type="circle"
          size={38}
          percent={Math.round(score * 100)}
          format={() => score.toFixed(2)}
          strokeWidth={10}
          aria-label={`Relevance ${score.toFixed(3)}, cosine similarity, higher is closer in meaning`}
        />

        <div className="result-card-main">
          <div className="result-card-head">
            <Typography.Text strong ellipsis={{ tooltip: hit.filepath }} className="result-file">
              {hit.filename}
            </Typography.Text>
            <Tag className="result-page">{pageLabel(hit)}</Tag>
            {hit.language ? <Tag>{hit.language}</Tag> : null}
          </div>

          {hit.heading ? (
            <Typography.Text type="secondary" ellipsis className="result-heading">
              {hit.heading}
            </Typography.Text>
          ) : null}

          <p
            className="result-text clamp"
            style={{ WebkitLineClamp: settings.previewLines }}
          >
            {highlight(body, query, settings.highlightTerms)}
          </p>
        </div>
      </div>
    </Card>
  )
}
