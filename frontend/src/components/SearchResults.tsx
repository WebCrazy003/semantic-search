// frontend/src/components/SearchResults.tsx
import { SearchResult } from './SearchResult'
import type { SearchResponse } from '../services/api'

interface Props {
  response: SearchResponse | null
  busy?: boolean
}

export function SearchResults({ response, busy = false }: Props) {
  if (busy && response === null) {
    return (
      <ul className="results" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <li key={index} className="result skeleton">
            <span className="skeleton-line short" />
            <span className="skeleton-line" />
            <span className="skeleton-line" />
          </li>
        ))}
      </ul>
    )
  }
  if (response === null) {
    return <p className="hint">Search your indexed PDF and Word files in Chinese, Korean, or English.</p>
  }
  if (response.count === 0) {
    return <p className="hint">No passages matched that query.</p>
  }
  return (
    <>
      <div className="result-meta">
        <span>
          <strong>{response.count}</strong> {response.count === 1 ? 'result' : 'results'}
        </span>
        <span>{response.took_ms} ms</span>
        <span className="muted">for “{response.query}”</span>
      </div>
      <ul className={`results${busy ? ' stale' : ''}`}>
        {response.results.map((hit) => (
          <SearchResult
            key={`${hit.document_id}-${hit.chunk_index}`}
            hit={hit}
            query={response.query}
          />
        ))}
      </ul>
    </>
  )
}
