// frontend/src/components/citations.ts
// Reading [n] citations out of a streamed answer. The answer is only ever treated as
// text: nothing here produces HTML.

import { keyOf } from '../app/resultKey'
import type { AskSources, SearchHit } from '../services/api'

export type AnswerPart = { kind: 'text'; text: string } | { kind: 'cite'; n: number }

// [1], [1, 2], [1,2], and the Chinese list marks [1，2] and [1、2]. [1][2] is two matches.
const CITATION = /\[(\s*\d+(?:\s*[,，、]\s*\d+)*\s*)\]/g

/** The model sometimes adds Markdown bold; the panel shows plain text. */
export function cleanAnswer(text: string): string {
  return text.replace(/\*\*/g, '')
}

/** The answer as text runs and citation numbers, in order. */
export function parseAnswer(text: string): AnswerPart[] {
  const parts: AnswerPart[] = []
  let last = 0
  for (const match of text.matchAll(CITATION)) {
    const start = match.index ?? 0
    if (start > last) parts.push({ kind: 'text', text: text.slice(last, start) })
    for (const number of match[1].split(/[,，、]/)) {
      parts.push({ kind: 'cite', n: Number(number.trim()) })
    }
    last = start + match[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}

/** Every number the answer cites, once each, in the order they first appear. */
export function citedNumbers(text: string): number[] {
  const seen = new Set<number>()
  for (const part of parseAnswer(text)) if (part.kind === 'cite') seen.add(part.n)
  return [...seen]
}

/** Which result each source number points at. A source not in the list is left out. */
export function hitsBySource(
  sources: AskSources | null,
  results: SearchHit[] | undefined,
): Map<number, SearchHit> {
  const map = new Map<number, SearchHit>()
  if (!sources || !results) return map
  const byKey = new Map(results.map((hit) => [keyOf(hit), hit]))
  for (const passage of sources.passages) {
    const hit = byKey.get(keyOf(passage))
    if (hit) map.set(passage.n, hit)
  }
  return map
}
