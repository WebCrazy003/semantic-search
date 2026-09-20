// frontend/src/services/api.ts
// Every call is same-origin: Vite proxies /api to the backend in development, and in
// production the backend serves the built assets. No absolute URLs, no external hosts.

export interface SearchHit {
  score: number
  document_id: string
  filename: string
  filepath: string
  page_start: number
  page_end: number
  chunk_index: number
  heading?: string | null
  language?: string | null
  text: string
}

export interface SearchResponse {
  query: string
  count: number
  took_ms: number
  results: SearchHit[]
}

export interface IndexFailure {
  filename: string
  filepath: string
  error_type: string
  error_message: string
  timestamp: string
}

export interface IndexStatus {
  status: 'idle' | 'running' | 'completed' | 'failed'
  directory: string | null
  total_documents: number
  indexed_documents: number
  skipped_documents: number
  unsupported_documents: number
  failed_documents: number
  deleted_documents: number
  total_chunks: number
  started_at: string | null
  finished_at: string | null
  failures: IndexFailure[]
}

export interface IndexStarted {
  status: 'started' | 'already_running'
  directory: string
}

export interface DocumentSummary {
  document_id: string
  filename: string
  filepath: string
  pages: number
  chunks: number
  language?: string | null
  title?: string | null
  status: string
  indexed_at?: string | null
}

export interface SearchParams {
  query: string
  topK: number
  language?: string
  documentId?: string
}

const JSON_HEADERS = { 'content-type': 'application/json' }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    // The offline story means a failed fetch almost always means the backend is down.
    throw new Error('Cannot reach the backend. Is it running on 127.0.0.1:8000?')
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail =
      body && typeof body === 'object' && 'detail' in body
        ? String((body as { detail: unknown }).detail)
        : `Request failed with status ${response.status}`
    throw new Error(detail)
  }
  return body as T
}

export async function search(params: SearchParams): Promise<SearchResponse> {
  const filters: Record<string, string> = {}
  if (params.language) filters.language = params.language
  if (params.documentId) filters.document_id = params.documentId

  return call<SearchResponse>('/api/search', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      query: params.query,
      top_k: params.topK,
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
    }),
  })
}

export async function startIndexing(directory?: string, force = false): Promise<IndexStarted> {
  const response = await fetch('/api/index', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ...(directory ? { directory } : {}), force }),
  }).catch(() => {
    throw new Error('Cannot reach the backend. Is it running on 127.0.0.1:8000?')
  })

  const body = await response.json().catch(() => null)
  // 409 is not an error for the UI: it means a run is already under way.
  if (response.status === 409) return body as IndexStarted
  if (!response.ok) {
    throw new Error(`Could not start indexing (status ${response.status})`)
  }
  return body as IndexStarted
}

export function getIndexStatus(): Promise<IndexStatus> {
  return call<IndexStatus>('/api/index/status')
}

export function getDocuments(status?: string): Promise<DocumentSummary[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  return call<DocumentSummary[]>(`/api/documents${query}`)
}
