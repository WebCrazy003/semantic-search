// frontend/src/__tests__/fixtures.ts
// Shared shapes for the UI tests, so adding a field to an API type is a one-line change.

import { vi } from 'vitest'
import type { Library } from '../hooks/useLibrary'
import type {
  DocumentSummary,
  IndexStatus,
  JobSummary,
} from '../services/api'

export function makeStatus(overrides: Partial<IndexStatus> = {}): IndexStatus {
  return {
    status: 'idle',
    job_id: null,
    trigger: 'scan',
    directory: null,
    current_file: null,
    current_stage: null,
    current_file_progress: 0,
    processed_documents: 0,
    total_documents: 0,
    indexed_documents: 0,
    skipped_documents: 0,
    unsupported_documents: 0,
    failed_documents: 0,
    deleted_documents: 0,
    total_chunks: 0,
    started_at: null,
    finished_at: null,
    failures: [],
    ...overrides,
  }
}

export function makeDocument(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    document_id: 'a'.repeat(64),
    filename: 'manual_zh.pdf',
    filepath: '/documents/manual_zh.pdf',
    file_size: 2_400_000,
    file_hash: 'a'.repeat(64),
    modified_at: '2026-09-20T12:00:00Z',
    pages: 102,
    chunks: 430,
    language: 'zh',
    title: '手册',
    status: 'indexed',
    error_type: null,
    error_message: null,
    alt_filepaths: [],
    indexed_at: '2026-09-20T12:00:00Z',
    ...overrides,
  }
}

export function makeJob(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    job_id: 'job-1',
    trigger: 'scan',
    directory: '/documents',
    status: 'completed',
    started_at: '2026-09-20T12:00:00Z',
    finished_at: '2026-09-20T12:00:39Z',
    total: 10,
    processed: 10,
    indexed: 10,
    skipped: 0,
    unsupported: 0,
    failed: 0,
    deleted: 0,
    chunks: 279,
    failures: [],
    ...overrides,
  }
}

export function makeLibrary(overrides: Partial<Library> = {}): Library {
  return {
    documents: [],
    loaded: true,
    status: makeStatus(),
    jobs: [],
    error: null,
    busy: false,
    lastUpload: null,
    lastClear: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    runIndexing: vi.fn().mockResolvedValue(undefined),
    importFiles: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clearAll: vi.fn().mockResolvedValue(undefined),
    dismissError: vi.fn(),
    ...overrides,
  }
}
