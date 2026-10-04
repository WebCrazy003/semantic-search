// frontend/src/components/AnswerPanel.tsx
// The answer written by the local model, above the results it was written from. The text
// is rendered as text, never as HTML: it comes from a model that read other people's
// documents, so it is untrusted. Each [n] becomes a chip that opens the cited result.

import {
  CheckOutlined,
  CopyOutlined,
  StarOutlined,
  StopOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { Button, Card, Skeleton, Tooltip, Typography } from 'antd'
import { useState, type ReactNode } from 'react'
import { useAnswer, useAnswerCitations } from '../app/AnswerContext'
import { keyOf } from '../app/resultKey'
import { useSearchContext } from '../app/SearchContext'
import type { AnswerLanguage, SearchHit } from '../services/api'
import { useSettings } from '../settings/SettingsContext'
import { parseAnswer } from './citations'
import { pageLabel } from './passage'

/** Fixed text in the answer's own language; the rest of the interface stays English. */
const FOOTER: Record<AnswerLanguage, string> = {
  en: 'Generated from your documents. Check the sources.',
  'zh-Hans': '根据您的文档生成，请核对来源。',
  'zh-Hant': '根據您的文件生成，請核對來源。',
  ko: '문서를 바탕으로 생성된 답변입니다. 출처를 확인하세요.',
}

const UNSUPPORTED = 'Answers are given in English, Chinese or Korean.'

/** Opens a result as if it had been clicked, and brings its card into view. */
function useOpenResult() {
  const { select } = useSearchContext()
  const { reducedMotion } = useSettings()
  return (hit: SearchHit) => {
    select(hit)
    const card = document.querySelector<HTMLElement>(`[data-result-key="${keyOf(hit)}"]`)
    if (!card) return
    card.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' })
    card.focus({ preventScroll: true })
  }
}

function Citation({ n, hit, onOpen }: { n: number; hit: SearchHit; onOpen: (hit: SearchHit) => void }) {
  return (
    <button
      type="button"
      className="citation"
      onClick={() => onOpen(hit)}
      aria-label={`Source ${n}: ${hit.filename}, ${pageLabel(hit)}`}
      title={`${hit.filename} · ${pageLabel(hit)}`}
    >
      {n}
    </button>
  )
}

export function AnswerPanel() {
  const { state, stopAnswer } = useAnswer()
  const { text, hits, cited } = useAnswerCitations()
  const { settings, reducedMotion } = useSettings()
  const openResult = useOpenResult()
  // The text last copied: a new answer shows a fresh Copy button by not matching it.
  const [copiedText, setCopiedText] = useState<string | null>(null)

  const { phase, sources: answerSources } = state
  const answerStatus = phase.status
  if (answerStatus === 'idle') return null
  const answerMeta = phase.status === 'done' || phase.status === 'not_found' ? phase.meta : null

  const copied = copiedText === text
  const writing = answerStatus === 'waiting' || answerStatus === 'streaming'
  const notFound = answerStatus === 'not_found'
  const language = answerSources?.language ?? 'en'

  const body: ReactNode[] = parseAnswer(text).map((part, index) => {
    if (part.kind === 'text') return <span key={index}>{part.text}</span>
    const hit = hits.get(part.n)
    return hit ? (
      <Citation key={index} n={part.n} hit={hit} onOpen={openResult} />
    ) : (
      <span key={index}>[{part.n}]</span>
    )
  })

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedText(text)
    } catch {
      // Clipboard access can be refused; the text is still there to select by hand.
    }
  }

  const actions = writing ? (
    <Button size="small" icon={<StopOutlined aria-hidden="true" />} onClick={stopAnswer}>
      Stop
    </Button>
  ) : answerStatus === 'done' && text ? (
    <Tooltip title={copied ? 'Copied' : 'Copy the answer'}>
      <Button
        size="small"
        type="text"
        icon={copied ? <CheckOutlined aria-hidden="true" /> : <CopyOutlined aria-hidden="true" />}
        onClick={() => void copy()}
        aria-label={copied ? 'Copied' : 'Copy the answer'}
      />
    </Tooltip>
  ) : null

  return (
    <Card
      size="small"
      className="answer-panel"
      data-testid="answer-panel"
      role="region"
      aria-label="Answer"
      title={
        <span className="answer-title">
          <StarOutlined aria-hidden="true" className="answer-icon" />
          Answer
        </span>
      }
      extra={actions}
    >
      {answerSources?.unsupported ? (
        <Typography.Text type="secondary" className="answer-notice">
          {UNSUPPORTED}
        </Typography.Text>
      ) : null}

      {/* Polite, and busy while words arrive, so a screen reader reads the answer once
          it is complete rather than announcing every token. */}
      <div className="answer-region" aria-live="polite" aria-busy={writing}>
        {answerStatus === 'waiting' && !text ? (
          <Skeleton
            active={!reducedMotion}
            title={false}
            paragraph={{ rows: 2, width: ['100%', '60%'] }}
            className="answer-skeleton"
          />
        ) : null}

        {text ? (
          <div
            className={`answer-text${notFound ? ' answer-not-found' : ''}`}
            data-testid="answer-text"
          >
            {body}
          </div>
        ) : null}

        {answerStatus === 'stopped' ? (
          <Typography.Text type="secondary" className="answer-note">
            {text ? 'Stopped.' : 'Stopped before an answer was written.'}
          </Typography.Text>
        ) : null}

        {phase.status === 'error' ? (
          <div className="answer-error">
            <WarningOutlined aria-hidden="true" /> {phase.message}
          </div>
        ) : null}
      </div>

      {cited.length > 0 ? (
        <div className="answer-sources">
          <Typography.Text type="secondary">Sources:</Typography.Text>
          {cited.map((n) => {
            const hit = hits.get(n) as SearchHit
            return (
              <span key={n} className="answer-source">
                <Citation n={n} hit={hit} onOpen={openResult} />
                <span className="answer-source-name">
                  {hit.filename} · {pageLabel(hit)}
                </span>
              </span>
            )
          })}
        </div>
      ) : null}

      {text && !notFound ? (
        <Typography.Text type="secondary" className="answer-footer" lang={language}>
          {FOOTER[language] ?? FOOTER.en}
        </Typography.Text>
      ) : null}

      {settings.developerMode && answerMeta ? (
        <Typography.Text type="secondary" className="answer-meta">
          {answerMeta.model} · {answerMeta.answer_ms} ms
          {answerMeta.restarted ? ' · restarted for language' : ''}
        </Typography.Text>
      ) : null}
    </Card>
  )
}
