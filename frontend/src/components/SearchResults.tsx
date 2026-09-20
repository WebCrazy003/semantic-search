// frontend/src/components/SearchResults.tsx
import { SearchResult } from './SearchResult'
import type { SearchResponse } from '../services/api'

interface Props {
  response: SearchResponse | null
}

export function SearchResults({ response }: Props) {
  if (response === null) {
    return <p className="hint">Search your indexed PDFs in Chinese, Korean, or English.</p>
  }
  if (response.count === 0) {
    return <p className="hint">No passages matched that query.</p>
  }
  return (
    <>
      <div className="result-meta">
        <span>
          {response.count} {response.count === 1 ? 'result' : 'results'}
        </span>
        <span>{response.took_ms} ms</span>
      </div>
      <ul className="results">
        {response.results.map((hit) => (
          <SearchResult key={`${hit.document_id}-${hit.chunk_index}`} hit={hit} />
        ))}
      </ul>
    </>
  )
}
