// frontend/src/app/SearchContext.tsx
// Search state lives above the router so a trip to Documents and back does not throw a
// result set away (spec R1.4). The old tab shell kept every tab mounted to get this;
// routes cannot, so the state moves up instead.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { search, type SearchHit, type SearchResponse } from '../services/api'
import { useSettings } from '../settings/SettingsContext'

interface SearchContextValue {
  query: string
  setQuery: (query: string) => void
  response: SearchResponse | null
  selected: SearchHit | null
  select: (hit: SearchHit | null) => void
  topK: number
  setTopK: (topK: number) => void
  language: string
  setLanguage: (language: string) => void
  busy: boolean
  error: string | null
  run: (query: string) => Promise<void>
}

const SearchContext = createContext<SearchContextValue | null>(null)

export function keyOf(hit: SearchHit): string {
  return `${hit.document_id}-${hit.chunk_index}`
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings()
  const [query, setQuery] = useState('')
  const [response, setResponse] = useState<SearchResponse | null>(null)
  const [selected, setSelected] = useState<SearchHit | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The settings are the starting point, not a binding: changing the control on the
  // search page must not be undone by a later settings read.
  const [topK, setTopK] = useState(settings.resultsPerSearch)
  const [language, setLanguage] = useState(settings.defaultLanguage)

  const run = useCallback(
    async (nextQuery: string) => {
      setQuery(nextQuery)
      setBusy(true)
      try {
        const result = await search({
          query: nextQuery,
          topK,
          ...(language ? { language } : {}),
        })
        setResponse(result)
        // A populated list beside an empty panel reads as broken, so the top hit is
        // selected for the user.
        setSelected(result.results[0] ?? null)
        setError(null)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Search failed')
        setResponse(null)
        setSelected(null)
      } finally {
        setBusy(false)
      }
    },
    [topK, language],
  )

  const value = useMemo<SearchContextValue>(
    () => ({
      query,
      setQuery,
      response,
      selected,
      select: setSelected,
      topK,
      setTopK,
      language,
      setLanguage,
      busy,
      error,
      run,
    }),
    [query, response, selected, topK, language, busy, error, run],
  )

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
}

export function useSearchContext(): SearchContextValue {
  const value = useContext(SearchContext)
  if (!value) throw new Error('useSearchContext must be used inside a SearchProvider')
  return value
}
