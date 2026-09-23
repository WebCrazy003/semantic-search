// frontend/src/components/passage.tsx
// Shared by the result card and the detail panel, so a passage reads the same in both.

import type { SearchHit } from '../services/api'

/** A Word file has no fixed pages; its numbers come from Word's last layout. */
export function pageLabel(hit: SearchHit): string {
  const about = hit.file_type === 'docx' ? '~' : ''
  return hit.page_start === hit.page_end
    ? `Page ${about}${hit.page_start}`
    : `Pages ${about}${hit.page_start} to ${about}${hit.page_end}`
}

/**
 * The chunker repeats a section heading at the top of each of its passages, which is
 * right for retrieval and redundant on screen next to the heading line.
 */
export function withoutRepeatedHeading(text: string, heading?: string | null): string {
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

const CJK = /[一-鿿㐀-䶿가-힯぀-ヿ]/

function isWorthMarking(term: string): boolean {
  if (CJK.test(term)) return term.length >= 2
  return term.length >= 4 && !STOPWORDS.has(term.toLowerCase())
}

/** Mark any part of the query that appears verbatim. Semantic hits often share none. */
export function highlight(text: string, query?: string, enabled = true) {
  const terms = (query ?? '')
    .split(/[\s,，。、]+/)
    .map((term) => term.trim())
    .filter(isWorthMarking)
  if (!enabled || terms.length === 0) return text

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
