// frontend/src/app/AnswerContext.tsx
// The answer being written, kept out of SearchContext: it changes with every streamed
// word, and the search box, filters, drawer and result cards must not re-render with it.
// SearchProvider owns the state (its run() drives the stream) and renders AnswerProvider.
//
// Two contexts: the answer itself, which changes per word and only AnswerPanel reads,
// and the citations, which change only when a new [n] appears and the result list reads
// for its badges.

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { citedNumbers, cleanAnswer, hitsBySource } from '../components/citations'
import type { SearchHit } from '../services/api'
import { textOf, type AnswerState } from './answerState'
import { keyOf } from './resultKey'

export interface AnswerCitations {
  /** Source number → the result it points at. */
  hits: Map<number, SearchHit>
  /** Numbers the answer cites that point at a result, ascending. */
  cited: number[]
  /** keyOf(result) → the number it is cited as, for the result cards' badges. */
  byResultKey: Map<string, number>
}

interface AnswerContextValue {
  state: AnswerState
  /** The answer as shown: the streamed text without Markdown bold markers. */
  text: string
  stopAnswer: () => void
}

const AnswerContext = createContext<AnswerContextValue | null>(null)

const NO_CITATIONS: AnswerCitations = { hits: new Map(), cited: [], byResultKey: new Map() }
const CitationsContext = createContext<AnswerCitations>(NO_CITATIONS)

export function AnswerProvider({
  state,
  stopAnswer,
  results,
  children,
}: {
  state: AnswerState
  stopAnswer: () => void
  results: SearchHit[] | undefined
  children: ReactNode
}) {
  const raw = textOf(state.phase)
  const text = useMemo(() => cleanAnswer(raw), [raw])
  // Only a newly cited number changes this key, so the maps below (and the result list
  // reading them) stay put while ordinary words stream in.
  const citedKey = state.phase.status === 'not_found' ? '' : citedNumbers(text).join(',')
  const { sources } = state

  const citations = useMemo<AnswerCitations>(() => {
    if (!citedKey) return NO_CITATIONS
    const hits = hitsBySource(sources, results)
    const cited = citedKey
      .split(',')
      .map(Number)
      .filter((n) => hits.has(n))
      .sort((a, b) => a - b)
    const byResultKey = new Map<string, number>()
    for (const n of cited) {
      const key = keyOf(hits.get(n) as SearchHit)
      if (!byResultKey.has(key)) byResultKey.set(key, n)
    }
    return { hits, cited, byResultKey }
  }, [citedKey, sources, results])

  const value = useMemo(() => ({ state, text, stopAnswer }), [state, text, stopAnswer])

  return (
    <AnswerContext.Provider value={value}>
      <CitationsContext.Provider value={citations}>{children}</CitationsContext.Provider>
    </AnswerContext.Provider>
  )
}

export function useAnswer(): AnswerContextValue {
  const value = useContext(AnswerContext)
  if (!value) throw new Error('useAnswer must be used inside a SearchProvider')
  return value
}

/** The answer's text with its citations: for the answer panel, which renders per word. */
export function useAnswerCitations(): AnswerCitations & { text: string } {
  const { text } = useAnswer()
  const citations = useContext(CitationsContext)
  return useMemo(() => ({ ...citations, text }), [citations, text])
}

/** Which results are cited, and as what number. Changes only when a new [n] appears. */
export function useCitedResults(): Map<string, number> {
  return useContext(CitationsContext).byResultKey
}
