// frontend/src/pages/SearchPage.tsx
import { useState } from 'react'
import { SearchBar } from '../components/SearchBar'
import { SearchResults } from '../components/SearchResults'
import { search, type SearchResponse } from '../services/api'

const TOP_K_CHOICES = [5, 10, 20, 50]

// Empty means no filter at all, which is not the same as filtering for "any".
const LANGUAGES = [
  { value: '', label: 'Any language' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'en', label: 'English' },
]

export function SearchPage() {
  const [response, setResponse] = useState<SearchResponse | null>(null)
  const [topK, setTopK] = useState(10)
  const [language, setLanguage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function runSearch(query: string) {
    setBusy(true)
    try {
      setResponse(await search({ query, topK, ...(language ? { language } : {}) }))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Search failed')
      setResponse(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page">
      <div className="search-row">
        <SearchBar onSearch={runSearch} busy={busy} />
        <label className="top-k">
          Results to show
          <select value={topK} onChange={(event) => setTopK(Number(event.target.value))}>
            {TOP_K_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        </label>
        <label className="top-k">
          Language
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            {LANGUAGES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p role="alert" className="error">{error}</p> : null}
      <SearchResults response={response} busy={busy} />
    </section>
  )
}
