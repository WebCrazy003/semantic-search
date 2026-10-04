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

/**
 * What to show as the passage. A passage that is only its heading would otherwise
 * render as nothing, so the heading stands in as the content.
 */
export function passageBody(hit: SearchHit): string {
  return withoutRepeatedHeading(hit.text, hit.heading) || hit.text.trim()
}

export type RelevanceBand = 'strong' | 'good' | 'weak'

// BGE-M3 cosine scores for a genuinely relevant passage sit around 0.6 to 0.8; below
// about 0.5 the match is usually topical at best.
export function relevanceBand(score: number): RelevanceBand {
  if (score >= 0.65) return 'strong'
  if (score >= 0.5) return 'good'
  return 'weak'
}

export const RELEVANCE_LABEL: Record<RelevanceBand, string> = {
  strong: 'Strong match',
  good: 'Good match',
  weak: 'Weak match',
}

// Highlighting every shared word turns a passage yellow and tells the reader nothing,
// so short and very common English words are left alone.
const STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'all', 'and', 'any', 'are', 'because', 'been',
  'before', 'being', 'between', 'both', 'but', 'can', 'did', 'does', 'doing', 'down',
  'during', 'each', 'for', 'from', 'had', 'has', 'have', 'having', 'her', 'here', 'him',
  'his', 'how', 'into', 'its', 'itself', 'just', 'more', 'most', 'need', 'not', 'now',
  'only', 'other', 'our', 'out', 'over', 'same', 'she', 'should', 'some', 'such', 'than',
  'that', 'the', 'them', 'then', 'there', 'these', 'they', 'this', 'through', 'too',
  'under', 'until', 'use', 'very', 'was', 'way', 'were', 'what', 'when', 'where', 'which',
  'who', 'while', 'why', 'will', 'with', 'work', 'would', 'you', 'your',
])

const CJK = /[一-鿿㐀-䶿가-힯぀-ヿ]/
const CJK_RUN = /[一-鿿㐀-䶿가-힯぀-ヿ]+/g

/**
 * The words of a query worth marking. CJK has no word spaces (and Korean attaches
 * particles to its words), so a long CJK run also contributes its two-character
 * pieces: 更换滤芯的步骤 still marks 滤芯 in a passage that never says it verbatim.
 */
export function highlightTerms(query?: string): string[] {
  const terms = new Set<string>()
  for (const raw of (query ?? '').split(/[\s,，。、；;：:!?！？()（）"'“”]+/)) {
    const term = raw.trim()
    if (!term) continue
    if (!CJK.test(term)) {
      if (term.length >= 3 && !STOPWORDS.has(term.toLowerCase())) terms.add(term)
      continue
    }
    for (const run of term.match(CJK_RUN) ?? []) {
      if (run.length >= 2) terms.add(run)
      for (let index = 0; run.length > 2 && index < run.length - 1; index++) {
        terms.add(run.slice(index, index + 2))
      }
    }
    // Latin words inside a mixed term, such as "React组件".
    for (const word of term.split(CJK_RUN)) {
      if (word.length >= 3 && !STOPWORDS.has(word.toLowerCase())) terms.add(word)
    }
  }
  // Longest first, so the alternation prefers 更换滤芯 over 更换.
  return [...terms].sort((a, b) => b.length - a.length)
}

// Every result highlights its title and passage against the same query, so the pattern
// is built once per query rather than once per call.
let cached: { query: string; pattern: RegExp | null } = { query: '', pattern: null }

function patternFor(query: string): RegExp | null {
  if (cached.query !== query) {
    const terms = highlightTerms(query)
    // One capture group: split() then puts the matches at the odd indices.
    const pattern = terms.length ? new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi') : null
    cached = { query, pattern }
  }
  return cached.pattern
}

/** Mark any part of the query that appears verbatim. Semantic hits often share none. */
export function highlight(text: string, query?: string, enabled = true) {
  if (!enabled || !query) return text
  const pattern = patternFor(query)
  if (!pattern) return text
  return text
    .split(pattern)
    .map((part, index) =>
      index % 2 === 1 ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>,
    )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
