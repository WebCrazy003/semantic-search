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
  file_type?: FileType
  text: string
}

/** 'docx' pages are Word's last layout, so they are shown as approximate. */
export type FileType = 'pdf' | 'docx'

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
  job_id: string | null
  trigger: string
  directory: string | null
  current_file: string | null
  current_stage: string | null
  current_file_progress: number
  processed_documents: number
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
  file_size: number
  file_hash: string
  modified_at?: string | null
  error_type?: string | null
  error_message?: string | null
  alt_filepaths: string[]
  pages: number
  chunks: number
  language?: string | null
  title?: string | null
  status: string
  indexed_at?: string | null
  file_type?: FileType
  pages_approximate?: boolean
}

export interface JobSummary {
  job_id: string
  trigger: string
  directory: string
  status: string
  started_at: string
  finished_at: string | null
  total: number
  processed: number
  indexed: number
  skipped: number
  unsupported: number
  failed: number
  deleted: number
  chunks: number
  failures: { filename: string; error_type: string; error_message: string }[]
}

export interface FolderSummary {
  path: string
  added_at: string
  exists: boolean
  readable: boolean
  document_count: number
  /** Deprecated: PDFs only. Use document_count. */
  pdf_count?: number
  indexed_documents: number
  is_default: boolean
}

export interface RemovedFolder {
  path: string
  documents_unindexed: number
  files_kept: boolean
}

export interface RejectedUpload {
  filename: string
  reason: string
}

export interface UploadResult {
  saved: string[]
  rejected: RejectedUpload[]
  directory: string
}

export interface RemovedDocument {
  document_id: string
  filename: string
  chunks_removed: number
  file_kept: boolean
}

export interface ClearResult {
  documents_removed: number
  passages_removed: number
  files_kept: boolean
}

export interface Readiness {
  status: 'ready' | 'degraded'
  model_loaded: boolean
  embedding_device?: 'cuda' | 'mps' | 'cpu' | null
  embedding_device_name?: string | null
  embedding_precision?: string | null
  embedding_batch_size?: number | null
  embedding_memory_gb?: number | null
  embedding_fallback_reason?: string | null
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

export async function fetchReadiness(): Promise<Readiness> {
  return call<Readiness>('/api/health/ready')
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

export async function startIndexing(
  options: { directory?: string; force?: boolean; trigger?: 'scan' | 'upload' } = {},
): Promise<IndexStarted> {
  const { directory, force = false, trigger = 'scan' } = options
  const response = await fetch('/api/index', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ...(directory ? { directory } : {}), force, trigger }),
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

export function getJobs(limit = 20): Promise<JobSummary[]> {
  return call<JobSummary[]>(`/api/index/jobs?limit=${limit}`)
}

export async function uploadDocuments(files: File[]): Promise<UploadResult> {
  const form = new FormData()
  for (const file of files) form.append('files', file)
  // No content-type header: the browser sets the multipart boundary itself.
  return call<UploadResult>('/api/documents/upload', { method: 'POST', body: form })
}

export function removeDocument(documentId: string): Promise<RemovedDocument> {
  return call<RemovedDocument>(`/api/documents/${documentId}`, { method: 'DELETE' })
}

export function clearIndex(): Promise<ClearResult> {
  return call<ClearResult>('/api/index/clear', { method: 'POST' })
}

/**
 * Where the browser can open one indexed PDF. The #page fragment is understood by
 * the built-in PDF viewers in Chrome, Safari and Firefox, so the file opens at the
 * passage rather than at page one.
 */
export function documentFileUrl(documentId: string, page?: number): string {
  const base = `/api/documents/${documentId}/file`
  return page && page > 0 ? `${base}#page=${page}` : base
}

export function getFolders(): Promise<FolderSummary[]> {
  return call<FolderSummary[]>('/api/folders')
}

export function addFolder(path: string): Promise<FolderSummary> {
  return call<FolderSummary>('/api/folders', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ path }),
  })
}

export function removeFolder(path: string): Promise<RemovedFolder> {
  return call<RemovedFolder>(`/api/folders?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
}

// ------------------------------------------------------------------ admin
// Read-only introspection, used only by the admin page.

export interface ExtractedBlock {
  kind: string
  text: string
}

export interface ExtractedPageView {
  page_number: number
  text: string
  char_count: number
  blocks: ExtractedBlock[]
}

export interface ExtractionResponse {
  document_id: string
  filename: string
  file_type: string
  filepath: string
  pages: number
  pages_approximate: boolean
  language?: string | null
  title?: string | null
  extracted_ms: number
  page: number
  per_page: number
  file_hash_matches_manifest: boolean
  page_views: ExtractedPageView[]
}

export interface ChunkView {
  chunk_index: number
  point_id: string
  page_start: number
  page_end: number
  heading?: string | null
  kind?: string | null
  token_count?: number | null
  char_count: number
  text: string
  overlap_start: number
  overlap_with_previous: number
}

export interface ChunkListResponse {
  document_id: string
  filename: string
  total_chunks: number
  total_tokens: number
  pages_covered: number
  offset: number
  limit: number
  chunks: ChunkView[]
}

export interface PayloadField {
  name: string
  type: string
  indexed: boolean
  description: string
}

export interface IndexSchemaResponse {
  qdrant: {
    collection: string
    exists: boolean
    vector_size?: number | null
    distance?: string | null
    points_count?: number | null
    segments_count?: number | null
    status?: string | null
    payload_indexes: string[]
    payload_fields: PayloadField[]
  }
  manifest: {
    path: string
    tables: {
      name: string
      rows: number
      columns: { name: string; type: string; notnull: boolean; pk: boolean }[]
      indexes: string[]
    }[]
    status_breakdown: Record<string, number>
  }
  chunking: {
    target_tokens: number
    max_tokens: number
    min_tokens: number
    overlap_tokens: number
    preserve_headings: boolean
    repeat_heading: boolean
    allow_cross_page: boolean
    prefer_paragraph_boundaries: boolean
    prefer_sentence_boundaries: boolean
  }
  embedding: {
    model: string
    vector_size: number
    device?: string | null
    device_name?: string | null
    precision?: string | null
    max_seq_length: number
  }
}

export function getIndexSchema(): Promise<IndexSchemaResponse> {
  return call<IndexSchemaResponse>('/api/admin/index/schema')
}

export function getExtraction(
  documentId: string,
  page = 1,
  perPage = 5,
): Promise<ExtractionResponse> {
  return call<ExtractionResponse>(
    `/api/admin/documents/${documentId}/extraction?page=${page}&per_page=${perPage}`,
  )
}

export function getChunks(documentId: string, offset = 0, limit = 50): Promise<ChunkListResponse> {
  return call<ChunkListResponse>(
    `/api/admin/documents/${documentId}/chunks?offset=${offset}&limit=${limit}`,
  )
}
