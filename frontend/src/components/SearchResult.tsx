// frontend/src/components/SearchResult.tsx
import type { SearchHit } from '../services/api'

interface Props {
  hit: SearchHit
}

function pageLabel(hit: SearchHit): string {
  return hit.page_start === hit.page_end
    ? `Page ${hit.page_start}`
    : `Pages ${hit.page_start} to ${hit.page_end}`
}

export function SearchResult({ hit }: Props) {
  return (
    <li className="result">
      <div className="result-head">
        <span className="result-file">{hit.filename}</span>
        <span className="result-page">{pageLabel(hit)}</span>
        <span className="result-score" title="Cosine similarity">
          {hit.score.toFixed(3)}
        </span>
        {hit.language ? <span className="result-language">{hit.language}</span> : null}
      </div>
      {hit.heading ? <div className="result-heading">{hit.heading}</div> : null}
      <p className="result-text">{hit.text}</p>
    </li>
  )
}
