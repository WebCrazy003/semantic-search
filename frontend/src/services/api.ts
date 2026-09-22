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
