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
  visibility?: Visibility
  is_mine?: boolean
  /** Admins only. */
  owner_id?: string | null
  owner_username?: string | null
}

export type Visibility = 'public' | 'private'

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

export interface DeviceUsage {
  device: 'cuda' | 'mps' | 'cpu'
  name?: string | null
  memory_used_gb?: number | null
  memory_total_gb?: number | null
  memory_percent?: number | null
  /** Percent of one core: a process using three cores fully reads 300. */
  cpu_percent?: number | null
  cpu_cores?: number | null
  gpu_percent?: number | null
}

export interface IndexStatus {
  status: 'idle' | 'running' | 'completed' | 'failed'
  job_id: string | null
  trigger: string
  /** 'library', or the user id whose uploads are being indexed. */
  scope?: string
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
  /** Present only while a job is running. */
  device?: DeviceUsage | null
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
  visibility?: Visibility
  is_mine?: boolean
  /** Admins only: a user id or 'library'. */
  owner_id?: string | null
  /** Admins only: null for the library. */
  owner_username?: string | null
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
  scope?: string
  started_by_username?: string | null
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
  /** Whether POST /api/ask can write answers. Missing on an older backend: treat as false. */
  answers_available?: boolean
  answer_model?: string | null
}

export type SearchScope = 'all' | 'mine' | 'public'

export interface SearchParams {
  query: string
  topK: number
  language?: string
  documentId?: string
  /** For regular users: their own documents, public ones, or both. */
  scope?: SearchScope
  /** Admins only. A user id, or 'library'. */
  ownerId?: string
  /** Admins only. */
  visibility?: Visibility
}

const JSON_HEADERS = { 'content-type': 'application/json' }

// ------------------------------------------------------------------ transport

const OFFLINE = 'Cannot reach the backend. Is it running on 127.0.0.1:8000?'
export const PASSWORD_CHANGE_REQUIRED = 'password_change_required'

type AuthListener = (event: 'unauthorized' | 'password_change_required') => void
let authListener: AuthListener | null = null

/** AuthContext registers here to hear that the session ended or a password must change. */
export function onAuthEvent(listener: AuthListener | null): void {
  authListener = listener
}

/**
 * Every request goes through here. It sends the session cookie, and on anything but a
 * read the X-DocSage header the backend requires: a form on another site cannot set a
 * custom header, which is what makes the cookie safe to send.
 */
async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (method !== 'GET' && method !== 'HEAD') headers.set('X-DocSage', '1')
  let response: Response
  try {
    response = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  } catch (caught) {
    // A cancelled request is the caller's own doing, not a backend that is down.
    if (isAbort(caught)) throw caught
    // The offline story means a failed fetch almost always means the backend is down.
    throw new Error(OFFLINE)
  }
  // Only for routes that need a session: a failed login is a 401 too, and must not
  // look like "you were logged out".
  if (!path.startsWith('/api/auth/')) {
    if (response.status === 401) authListener?.('unauthorized')
    if (response.status === 403) {
      const detail = await response
        .clone()
        .json()
        .then((body: { detail?: unknown }) => body?.detail)
        .catch(() => null)
      if (detail === PASSWORD_CHANGE_REQUIRED) authListener?.('password_change_required')
    }
  }
  return response
}

function isAbort(caught: unknown): boolean {
  return (
    typeof caught === 'object' &&
    caught !== null &&
    (caught as { name?: unknown }).name === 'AbortError'
  )
}

/** The backend's `detail`, or a generic line when the body has none. */
function failure(body: unknown, status: number): Error {
  return new Error(
    body && typeof body === 'object' && 'detail' in body
      ? String((body as { detail: unknown }).detail)
      : `Request failed with status ${status}`,
  )
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await send(path, init)
  if (response.status === 204) return undefined as T

  const body = await response.json().catch(() => null)
  if (!response.ok) throw failure(body, response.status)
  return body as T
}

let readinessInFlight: Promise<Readiness> | null = null

/**
 * Callers that ask at the same moment (the search page's answer check and the device
 * line, both on load) share one request. A later call asks again.
 */
export function fetchReadiness(): Promise<Readiness> {
  if (!readinessInFlight) {
    readinessInFlight = call<Readiness>('/api/health/ready').finally(() => {
      readinessInFlight = null
    })
  }
  return readinessInFlight
}

/** The JSON body of /api/search, which /api/ask takes unchanged. */
function searchBody(params: SearchParams): string {
  const filters: Record<string, string> = {}
  if (params.language) filters.language = params.language
  if (params.documentId) filters.document_id = params.documentId
  if (params.ownerId) filters.owner_id = params.ownerId
  if (params.visibility) filters.visibility = params.visibility

  return JSON.stringify({
    query: params.query,
    top_k: params.topK,
    ...(params.scope && params.scope !== 'all' ? { scope: params.scope } : {}),
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
  })
}

export async function search(params: SearchParams): Promise<SearchResponse> {
  return call<SearchResponse>('/api/search', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: searchBody(params),
  })
}

// ------------------------------------------------------------------ answers

/** The language the answer is written in, decided by the backend from the question. */
export type AnswerLanguage = 'en' | 'zh-Hans' | 'zh-Hant' | 'ko'

export interface AskSource {
  /** The number the answer cites as [n]. */
  n: number
  document_id: string
  chunk_index: number
}

export interface AskSources {
  language: AnswerLanguage
  /** The question was in another language, so the answer is in English. */
  unsupported: boolean
  passages: AskSource[]
}

export interface AskDone {
  status: 'answered' | 'not_found'
  answer_ms: number
  model: string
  restarted: boolean
}

export interface AskError {
  code: 'unavailable' | 'failed'
  message: string
}

export interface AskHandlers {
  /** First, about as fast as /api/search: the result list. */
  onResults: (response: SearchResponse) => void
  onSources: (sources: AskSources) => void
  onDelta: (text: string) => void
  onDone: (done: AskDone) => void
  onError: (error: AskError) => void
}

export const ANSWER_STOPPED = 'The answer stopped unexpectedly.'

/**
 * POST /api/ask and read its Server-Sent Events. EventSource cannot POST, so the stream
 * is read from the response body here.
 *
 * Until `results` has arrived, any failure (offline, an old backend's 404, a 503, an
 * `error` event) rejects, so the caller can fall back to a plain search. After it,
 * failures go to `onError` and the promise resolves. A cancelled request resolves
 * quietly at any point and calls nothing further.
 */
export async function ask(
  params: SearchParams,
  handlers: AskHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response
  try {
    response = await send('/api/ask', {
      method: 'POST',
      headers: { ...JSON_HEADERS, accept: 'text/event-stream' },
      body: searchBody(params),
      signal,
    })
  } catch (caught) {
    if (isAbort(caught) || signal?.aborted) return
    throw caught
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    if (signal?.aborted) return
    throw failure(body, response.status)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('The answer could not be read.')

  // Some streams only end a pending read on abort if they are cancelled.
  const cancel = () => void reader.cancel().catch(() => undefined)
  signal?.addEventListener('abort', cancel, { once: true })

  let seenResults = false
  let finished = false

  /** Returns true once the stream has said its last word. */
  function dispatch(block: string): boolean {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      let value = colon === -1 ? '' : line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'event') event = value
      else if (field === 'data') data.push(value)
    }
    if (data.length === 0) return false

    let payload: unknown
    try {
      payload = JSON.parse(data.join('\n'))
    } catch {
      return false
    }

    switch (event) {
      case 'results':
        seenResults = true
        handlers.onResults(payload as SearchResponse)
        return false
      case 'sources':
        handlers.onSources(payload as AskSources)
        return false
      case 'delta': {
        const text = (payload as { text?: unknown }).text
        if (typeof text === 'string' && text) handlers.onDelta(text)
        return false
      }
      case 'done':
        handlers.onDone(payload as AskDone)
        return true
      case 'error': {
        const error = payload as Partial<AskError>
        const message = typeof error.message === 'string' ? error.message : ANSWER_STOPPED
        // Without results there is nothing to keep: let the caller fall back.
        if (!seenResults) throw new Error(message)
        handlers.onError({ code: error.code === 'unavailable' ? 'unavailable' : 'failed', message })
        return true
      }
      default:
        return false
    }
  }

  const decoder = new TextDecoder()
  let buffer = ''

  /** Appends text, normalising CR and CRLF to LF. A CR at the very end may be half a CRLF. */
  function append(text: string, last: boolean) {
    let combined = buffer + text
    const heldCr = !last && combined.endsWith('\r')
    if (heldCr) combined = combined.slice(0, -1)
    buffer = combined.replace(/\r\n?/g, '\n') + (heldCr ? '\r' : '')
  }

  /** Dispatches every complete event in the buffer. */
  function drain(): boolean {
    for (let end = buffer.indexOf('\n\n'); end !== -1; end = buffer.indexOf('\n\n')) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      if (signal?.aborted) return true
      if (dispatch(block)) return true
    }
    return false
  }

  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (caught) {
        if (isAbort(caught) || signal?.aborted) return
        if (!seenResults) throw new Error(OFFLINE)
        handlers.onError({ code: 'failed', message: ANSWER_STOPPED })
        return
      }
      if (signal?.aborted) return
      if (chunk.done) {
        append(decoder.decode(), true)
        // A last event without its blank line still counts.
        if (buffer.trim()) buffer += '\n\n'
        finished = drain()
        break
      }
      append(decoder.decode(chunk.value, { stream: true }), false)
      if (drain()) {
        finished = true
        break
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
    // Harmless on a stream that ended; frees the connection on one that did not.
    cancel()
  }

  if (finished || signal?.aborted) return
  if (!seenResults) throw new Error(ANSWER_STOPPED)
  handlers.onError({ code: 'failed', message: ANSWER_STOPPED })
}

export async function startIndexing(
  options: { directory?: string; force?: boolean; trigger?: 'scan' | 'upload' } = {},
): Promise<IndexStarted> {
  const { directory, force = false, trigger = 'scan' } = options
  const response = await send('/api/index', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ...(directory ? { directory } : {}), force, trigger }),
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

// ------------------------------------------------------------------ accounts

export type Role = 'user' | 'admin'

export interface User {
  user_id: string
  username: string
  role: Role
  must_change_password: boolean
}

export interface AuthStatus {
  setup_required: boolean
  registration_open: boolean
  user: User | null
}

export interface Me {
  user: User
  /** Admins only. */
  pending_reset_requests?: number | null
}

export type ResetState = 'pending' | 'approved' | 'denied' | 'completed' | 'expired' | 'superseded'

export interface ResetRequestCreated {
  request_token: string
  expires_at: string
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return call<T>(path, {
    method: 'POST',
    ...(body === undefined ? {} : { headers: JSON_HEADERS, body: JSON.stringify(body) }),
  })
}

export function getAuthStatus(): Promise<AuthStatus> {
  return call<AuthStatus>('/api/auth/status')
}

export function getMe(): Promise<Me> {
  return call<Me>('/api/auth/me')
}

export function setupAdmin(username: string, password: string): Promise<Me> {
  return post<Me>('/api/auth/setup', { username, password })
}

export function register(username: string, password: string): Promise<Me> {
  return post<Me>('/api/auth/register', { username, password })
}

export function login(username: string, password: string): Promise<Me> {
  return post<Me>('/api/auth/login', { username, password })
}

export function logout(): Promise<void> {
  return post<void>('/api/auth/logout')
}

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return post<void>('/api/auth/password', {
    current_password: currentPassword,
    new_password: newPassword,
  })
}

export function requestPasswordReset(username: string): Promise<ResetRequestCreated> {
  return post<ResetRequestCreated>('/api/auth/reset-requests', { username })
}

export function getResetStatus(
  requestToken: string,
): Promise<{ status: ResetState; expires_at?: string | null }> {
  return post('/api/auth/reset-requests/status', { request_token: requestToken })
}

export function completePasswordReset(requestToken: string, newPassword: string): Promise<Me> {
  return post<Me>('/api/auth/reset-requests/complete', {
    request_token: requestToken,
    new_password: newPassword,
  })
}

// ------------------------------------------------------------ administration

export interface UserAdminView {
  user_id: string
  username: string
  role: Role
  disabled: boolean
  must_change_password: boolean
  created_at: string
  last_login_at: string | null
  documents: number
  public_documents: number
  passages: number
}

export interface ResetRequestView {
  request_id: string
  user_id: string
  username: string
  user_disabled: boolean
  created_at: string
  expires_at: string
  client_ip: string | null
}

export function listUsers(): Promise<UserAdminView[]> {
  return call<UserAdminView[]>('/api/admin/users')
}

export function createUser(
  username: string,
  role: Role,
): Promise<{ user: UserAdminView; temporary_password: string }> {
  return post('/api/admin/users', { username, role })
}

export function updateUser(
  userId: string,
  changes: { role?: Role; disabled?: boolean },
): Promise<UserAdminView> {
  return call<UserAdminView>(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(changes),
  })
}

/** Leave `newPassword` empty to have one generated; it comes back once, here. */
export function adminResetPassword(
  userId: string,
  newPassword: string | null,
  mustChange: boolean,
): Promise<{ temporary_password: string | null }> {
  return post(`/api/admin/users/${userId}/reset-password`, {
    ...(newPassword ? { new_password: newPassword } : {}),
    must_change: mustChange,
  })
}

export function deleteUser(userId: string): Promise<{
  username: string
  documents_removed: number
  passages_removed: number
  files_removed: number
}> {
  return call(`/api/admin/users/${userId}?documents=delete`, { method: 'DELETE' })
}

export function listResetRequests(): Promise<ResetRequestView[]> {
  return call<ResetRequestView[]>('/api/admin/reset-requests')
}

export function approveResetRequest(requestId: string): Promise<void> {
  return post<void>(`/api/admin/reset-requests/${requestId}/approve`)
}

export function denyResetRequest(requestId: string): Promise<void> {
  return post<void>(`/api/admin/reset-requests/${requestId}/deny`)
}

export function setDocumentVisibility(
  documentId: string,
  visibility: Visibility,
): Promise<{ document_id: string; visibility: Visibility }> {
  return call(`/api/documents/${documentId}/visibility`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ visibility }),
  })
}

export function setVisibilityInBulk(
  documentIds: string[],
  visibility: Visibility,
): Promise<{ updated: number; not_found: string[] }> {
  return post('/api/admin/documents/visibility', { document_ids: documentIds, visibility })
}

export function getAuthSettings(): Promise<{ registration_open: boolean }> {
  return call('/api/admin/auth-settings')
}

export function setRegistrationOpen(open: boolean): Promise<{ registration_open: boolean }> {
  return call('/api/admin/auth-settings', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ registration_open: open }),
  })
}
