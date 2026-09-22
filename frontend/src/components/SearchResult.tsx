// frontend/src/components/SearchResult.tsx
import { useState } from 'react'
import { documentFileUrl, type SearchHit } from '../services/api'

interface Props {
  hit: SearchHit
  query?: string
}

// A passage can run to a couple of thousand characters. The card shows a generous
// opening so most results can be judged without expanding, and holds the rest behind
// Show more so a long passage does not bury the next result.
const SNIPPET_CHARS = 460
const SENTENCE_ENDS = /[。！？；.!?;]/g

function snippet(text: string): string {
  if (text.length <= SNIPPET_CHARS) return text

  // Prefer cutting at a sentence end near the limit; a mid-word cut reads badly in
  // English and a mid-clause cut reads badly in Chinese.
  const window = text.slice(0, SNIPPET_CHARS + 40)
  let cut = -1
  for (const match of window.matchAll(SENTENCE_ENDS)) {
    const end = (match.index ?? 0) + 1
    if (end >= SNIPPET_CHARS * 0.6) {
      cut = end
      break
    }
  }
  return (cut > 0 ? text.slice(0, cut) : text.slice(0, SNIPPET_CHARS).trimEnd()) + '…'
}

// A Word file has no fixed pages; its numbers come from Word's last layout.
function pageLabel(hit: SearchHit): string {
  const about = hit.file_type === 'docx' ? '~' : ''
  return hit.page_start === hit.page_end
    ? `Page ${about}${hit.page_start}`
    : `Pages ${about}${hit.page_start} to ${about}${hit.page_end}`
}

export function SearchResult({ hit, query }: Props) {
  const [expanded, setExpanded] = useState(false)
  const body = withoutRepeatedHeading(hit.text, hit.heading)
  const short = snippet(body)
  const truncated = short !== body
  const shown = expanded ? body : short

  return (
    <li className="result">
      <div className="result-head">
        <span className="result-file" title={hit.filepath}>
          {hit.filename}
        </span>
        <span className="result-page">{pageLabel(hit)}</span>
        <span className="result-score" title="Cosine similarity, higher is closer in meaning">
          <span className="score-bar" aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(1, hit.score)) * 100}%` }} />
          </span>
          {hit.score.toFixed(3)}
        </span>
        {hit.language ? <span className="badge subtle">{hit.language}</span> : null}
      </div>

      {hit.heading ? <div className="result-heading">{hit.heading}</div> : null}

      <p className={`result-text${expanded ? ' expanded' : ''}`}>{highlight(shown, query)}</p>

      <div className="result-actions">
        {truncated ? (
          <button
            type="button"
            className="link-button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded
              ? 'Show less'
              : `Show more (${body.length - short.length + 1} more characters)`}
          </button>
        ) : null}

        {hit.file_type === 'docx' ? (
          // Browsers cannot show a .docx, so it downloads and opens in Word.
          <a className="open-source" href={documentFileUrl(hit.document_id)} download>
            Download the Word file ↓
          </a>
        ) : (
          <a
            className="open-source"
            href={documentFileUrl(hit.document_id, hit.page_start)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open {pageLabel(hit).toLowerCase()} in the PDF ↗
          </a>
        )}

        <span className="result-path" title={hit.filepath}>
          {hit.filepath}
        </span>
      </div>
    </li>
  )
}

/**
 * The chunker repeats a section heading at the top of each of its passages, which is
 * right for retrieval and redundant on screen next to the heading line.
 */
function withoutRepeatedHeading(text: string, heading?: string | null): string {
  if (!heading) return text
  const trimmed = text.trimStart()
  return trimmed.startsWith(heading) ? trimmed.slice(heading.length).trimStart() : text
}

// Highlighting every shared word turns a passage yellow and tells the reader nothing,
// so short and very common English words are left alone. CJK has no word spaces, so a
// two-character term there is already specific.
const STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'because', 'been', 'before', 'being', 'between',
  'both', 'does', 'doing', 'down', 'during', 'each', 'from', 'have', 'having', 'here',
  'how', 'into', 'itself', 'just', 'more', 'most', 'need', 'only', 'other', 'over',
  'same', 'should', 'some', 'such', 'than', 'that', 'them', 'then', 'there', 'these',
  'they', 'this', 'through', 'under', 'until', 'very', 'what', 'when', 'where', 'which',
  'while', 'will', 'with', 'work', 'would', 'your',
])

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf\uac00-\ud7af\u3040-\u30ff]/

function isWorthMarking(term: string): boolean {
  if (CJK.test(term)) return term.length >= 2
  return term.length >= 4 && !STOPWORDS.has(term.toLowerCase())
}

/** Mark any part of the query that appears verbatim. Semantic hits often share none. */
function highlight(text: string, query?: string) {
  const terms = (query ?? '')
    .split(/[\s,，。、]+/)
    .map((term) => term.trim())
    .filter(isWorthMarking)
  if (terms.length === 0) return text

  // split() with one capture group puts the matches at the odd indices, so no second
  // test against the (stateful, global) pattern is needed.
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
  return text
    .split(pattern)
    .map((part, index) =>
      index % 2 === 1 ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>,
    )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
