// frontend/src/__tests__/DocumentsPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentsPage } from '../pages/DocumentsPage'
import * as api from '../services/api'

const documents: api.DocumentSummary[] = [
  {
    document_id: 'a',
    filename: 'manual_zh.pdf',
    filepath: '/documents/manual_zh.pdf',
    pages: 102,
    chunks: 430,
    language: 'zh',
    title: '手册',
    status: 'indexed',
    indexed_at: '2026-09-20T12:00:00Z',
  },
  {
    document_id: 'b',
    filename: 'scan.pdf',
    filepath: '/documents/scan.pdf',
    pages: 0,
    chunks: 0,
    language: null,
    title: null,
    status: 'unsupported',
    indexed_at: '2026-09-20T12:00:00Z',
  },
]

const idle: api.IndexStatus = {
  status: 'idle',
  directory: null,
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
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DocumentsPage', () => {
  it('lists each document with its page and chunk counts', async () => {
    vi.spyOn(api, 'getDocuments').mockResolvedValue(documents)
    vi.spyOn(api, 'getIndexStatus').mockResolvedValue(idle)
    render(<DocumentsPage />)

    await waitFor(() => expect(screen.getByText('manual_zh.pdf')).toBeInTheDocument())
    const row = screen.getByText('manual_zh.pdf').closest('tr')
    expect(row).not.toBeNull()
    expect(row).toHaveTextContent('102')
    expect(row).toHaveTextContent('430')
    expect(row).toHaveTextContent('indexed')
  })

  it('shows an unsupported document with its status', async () => {
    vi.spyOn(api, 'getDocuments').mockResolvedValue(documents)
    vi.spyOn(api, 'getIndexStatus').mockResolvedValue(idle)
    render(<DocumentsPage />)
    await waitFor(() => expect(screen.getByText('scan.pdf')).toBeInTheDocument())
    expect(screen.getByText('scan.pdf').closest('tr')).toHaveTextContent('unsupported')
  })

  it('shows a message when nothing is indexed yet', async () => {
    vi.spyOn(api, 'getDocuments').mockResolvedValue([])
    vi.spyOn(api, 'getIndexStatus').mockResolvedValue(idle)
    render(<DocumentsPage />)
    await waitFor(() => expect(screen.getByText(/no documents indexed/i)).toBeInTheDocument())
  })

  it('starts indexing and refreshes when the button is clicked', async () => {
    vi.spyOn(api, 'getDocuments').mockResolvedValue([])
    vi.spyOn(api, 'getIndexStatus').mockResolvedValue(idle)
    const start = vi
      .spyOn(api, 'startIndexing')
      .mockResolvedValue({ status: 'started', directory: '/documents' })
    render(<DocumentsPage />)
    await userEvent.click(await screen.findByRole('button', { name: /index documents/i }))
    expect(start).toHaveBeenCalled()
  })

  it('reports the counters from a completed run', async () => {
    vi.spyOn(api, 'getDocuments').mockResolvedValue(documents)
    vi.spyOn(api, 'getIndexStatus').mockResolvedValue({
      ...idle,
      status: 'completed',
      directory: '/documents',
      total_documents: 10,
      indexed_documents: 9,
      unsupported_documents: 1,
      total_chunks: 4350,
    })
    render(<DocumentsPage />)
    await waitFor(() => expect(screen.getByText(/completed/i)).toBeInTheDocument())
    expect(screen.getByText(/9 of 10 indexed/i)).toBeInTheDocument()
    expect(screen.getByText(/4350 passages/i)).toBeInTheDocument()
  })

  it('lists indexing failures', async () => {
    vi.spyOn(api, 'getDocuments').mockResolvedValue([])
    vi.spyOn(api, 'getIndexStatus').mockResolvedValue({
      ...idle,
      status: 'completed',
      failed_documents: 1,
      failures: [
        {
          filename: 'broken.pdf',
          filepath: '/documents/broken.pdf',
          error_type: 'PdfExtractionError',
          error_message: 'cannot open broken.pdf',
          timestamp: '2026-09-20T12:00:00Z',
        },
      ],
    })
    render(<DocumentsPage />)
    await waitFor(() => expect(screen.getByText('broken.pdf')).toBeInTheDocument())
    expect(screen.getByText(/cannot open broken.pdf/)).toBeInTheDocument()
  })

  it('shows the error when the document list cannot be loaded', async () => {
    vi.spyOn(api, 'getDocuments').mockRejectedValue(new Error('Cannot reach the backend.'))
    vi.spyOn(api, 'getIndexStatus').mockRejectedValue(new Error('Cannot reach the backend.'))
    render(<DocumentsPage />)
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Cannot reach the backend.'),
    )
  })
})
