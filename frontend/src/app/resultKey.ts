// frontend/src/app/resultKey.ts
// One passage's identity: a result, and an answer source that points at it, share it.

import type { SearchHit } from '../services/api'

export function keyOf(passage: Pick<SearchHit, 'document_id' | 'chunk_index'>): string {
  return `${passage.document_id}-${passage.chunk_index}`
}
