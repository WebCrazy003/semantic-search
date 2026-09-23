// frontend/src/__tests__/AdminPage.test.tsx
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminPage } from '../pages/AdminPage'
import * as api from '../services/api'
import { makeDocument, makeStatus } from './fixtures'
import { renderWithProviders } from './helpers'

const schema: api.IndexSchemaResponse = {
  qdrant: {
    collection: 'pdf_passages',
    exists: true,
    vector_size: 1024,
    distance: 'Cosine',
    points_count: 4821,
    segments_count: 2,
    status: 'green',
    payload_indexes: ['document_id', 'filename', 'language'],
    payload_fields: [
      {
        name: 'document_id',
        type: 'keyword',
        indexed: true,
        description: 'Which document the passage came from',
      },
      { name: 'text', type: 'text', indexed: false, description: 'The passage itself' },
    ],
  },
  manifest: {
    path: 'data/manifest.db',
    tables: [
      {
        name: 'documents',
        rows: 17,
        columns: [
          { name: 'document_id', type: 'TEXT', notnull: true, pk: true },
          { name: 'filename', type: 'TEXT', notnull: true, pk: false },
        ],
        indexes: ['idx_documents_status'],
      },
    ],
    status_breakdown: { indexed: 15, failed: 2 },
  },
  chunking: {
    target_tokens: 300,
    max_tokens: 450,
    min_tokens: 80,
    overlap_tokens: 50,
    preserve_headings: true,
    repeat_heading: true,
    allow_cross_page: false,
    prefer_paragraph_boundaries: true,
    prefer_sentence_boundaries: true,
  },
  embedding: {
    model: 'bge-m3',
    vector_size: 1024,
    device: 'mps',
    device_name: 'Apple GPU',
    precision: 'fp32',
    max_seq_length: 512,
  },
}

const extraction: api.ExtractionResponse = {
  document_id: 'a',
  filename: 'manual_zh.pdf',
  file_type: 'pdf',
  filepath: '/documents/manual_zh.pdf',
  pages: 12,
  pages_approximate: false,
  language: 'zh',
  title: '手册',
  extracted_ms: 340,
  page: 1,
  per_page: 5,
  file_hash_matches_manifest: true,
  page_views: [
    {
      page_number: 1,
      text: '第一章 安全注意事项\n在更换滤芯之前，必须先关闭主电源开关。',
      char_count: 32,
      blocks: [
        { kind: 'heading', text: '第一章 安全注意事项' },
        { kind: 'paragraph', text: '在更换滤芯之前，必须先关闭主电源开关。' },
      ],
    },
    { page_number: 2, text: '', char_count: 0, blocks: [] },
  ],
}

const chunks: api.ChunkListResponse = {
  document_id: 'a',
  filename: 'manual_zh.pdf',
  total_chunks: 2,
  total_tokens: 420,
  pages_covered: 3,
  offset: 0,
  limit: 25,
  chunks: [
    {
      chunk_index: 0,
      point_id: 'p0',
      page_start: 1,
      page_end: 1,
      heading: '第一章',
      kind: 'text',
      token_count: 220,
      char_count: 40,
      text: '在更换滤芯之前，必须先关闭主电源开关。',
      overlap_start: 0,
      overlap_with_previous: 0,
    },
    {
      chunk_index: 1,
      point_id: 'p1',
      page_start: 1,
      page_end: 2,
      heading: '第一章',
      kind: 'text',
      token_count: 200,
      char_count: 36,
      // The heading is repeated at the top, so the repeat starts after it.
      text: '第一章\n\n必须先关闭主电源开关。然后拆下外壳。',
      overlap_start: 5,
      overlap_with_previous: 11,
    },
  ],
}

beforeEach(() => {
  vi.spyOn(api, 'getDocuments').mockResolvedValue([
    makeDocument({ document_id: 'a', filename: 'manual_zh.pdf' }),
  ])
  vi.spyOn(api, 'getIndexStatus').mockResolvedValue(makeStatus())
  vi.spyOn(api, 'getJobs').mockResolvedValue([])
  vi.spyOn(api, 'getIndexSchema').mockResolvedValue(schema)
  vi.spyOn(api, 'getExtraction').mockResolvedValue(extraction)
  vi.spyOn(api, 'getChunks').mockResolvedValue(chunks)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the page itself', () => {
  it('says it is read-only', () => {
    renderWithProviders(<AdminPage />)
    expect(screen.getByText(/nothing on this page changes the index/i)).toBeInTheDocument()
  })

  it('asks for a document before extracting anything', () => {
    renderWithProviders(<AdminPage />)
    expect(screen.getByText(/choose a document to inspect/i)).toBeInTheDocument()
    expect(api.getExtraction).not.toHaveBeenCalled()
  })
})

describe('extracted text', () => {
  it('shows the text of each page', async () => {
    renderWithProviders(<AdminPage />, '/admin?document=a')
    expect(await screen.findByText(/在更换滤芯之前/)).toBeInTheDocument()
    await waitFor(() => expect(api.getExtraction).toHaveBeenCalledWith('a', 1, 5))
  })

  it('reports how long extraction took, and from where', async () => {
    renderWithProviders(<AdminPage />, '/admin?document=a')
    expect(await screen.findByText('340 ms')).toBeInTheDocument()
    expect(screen.getByText('/documents/manual_zh.pdf')).toBeInTheDocument()
  })

  it('flags a page with no extractable text as probably scanned', async () => {
    renderWithProviders(<AdminPage />, '/admin?document=a')
    expect(await screen.findByText(/likely a scanned page/i)).toBeInTheDocument()
  })

  it('can show the blocks instead of the page text', async () => {
    renderWithProviders(<AdminPage />, '/admin?document=a')
    await screen.findByText(/在更换滤芯之前/)
    await userEvent.click(screen.getByText('Blocks'))
    expect(await screen.findByText('heading')).toBeInTheDocument()
    expect(screen.getByText('paragraph')).toBeInTheDocument()
  })

  it('pages through a long document', async () => {
    renderWithProviders(<AdminPage />, '/admin?document=a')
    await screen.findByText(/在更换滤芯之前/)
    await userEvent.click(screen.getByTitle('3'))
    await waitFor(() => expect(api.getExtraction).toHaveBeenCalledWith('a', 3, 5))
  })

  it('warns when the file has changed since it was indexed', async () => {
    vi.spyOn(api, 'getExtraction').mockResolvedValue({
      ...extraction,
      file_hash_matches_manifest: false,
    })
    renderWithProviders(<AdminPage />, '/admin?document=a')
    expect(await screen.findByText(/has changed since it was indexed/i)).toBeInTheDocument()
  })

  it('reports a document that can no longer be read', async () => {
    vi.spyOn(api, 'getExtraction').mockRejectedValue(
      new Error('manual_zh.pdf is no longer in any folder in the library'),
    )
    renderWithProviders(<AdminPage />, '/admin?document=a')
    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer in any folder/i)
  })
})

describe('index structure', () => {
  it('shows the real collection size and shape', async () => {
    renderWithProviders(<AdminPage />)
    await userEvent.click(screen.getByRole('tab', { name: /index structure/i }))
    expect(await screen.findByText('4821')).toBeInTheDocument()
    expect(screen.getByText('Cosine')).toBeInTheDocument()
    expect(screen.getAllByText('1024').length).toBeGreaterThan(0)
  })

  it('explains what each passage stores', async () => {
    renderWithProviders(<AdminPage />)
    await userEvent.click(screen.getByRole('tab', { name: /index structure/i }))
    expect(await screen.findByText('Which document the passage came from')).toBeInTheDocument()
  })

  it('shows the manifest tables and their row counts', async () => {
    renderWithProviders(<AdminPage />)
    await userEvent.click(screen.getByRole('tab', { name: /index structure/i }))
    expect(await screen.findByText('17 rows')).toBeInTheDocument()
    expect(screen.getByText('idx_documents_status')).toBeInTheDocument()
  })

  it('shows the chunking settings that produced the passages', async () => {
    renderWithProviders(<AdminPage />)
    await userEvent.click(screen.getByRole('tab', { name: /index structure/i }))
    expect(await screen.findByText('Target tokens')).toBeInTheDocument()
    expect(screen.getByText('300')).toBeInTheDocument()
  })

  it('reports a schema it cannot read', async () => {
    vi.spyOn(api, 'getIndexSchema').mockRejectedValue(new Error('Cannot reach the backend.'))
    renderWithProviders(<AdminPage />)
    await userEvent.click(screen.getByRole('tab', { name: /index structure/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the backend.')
  })
})

describe('passages', () => {
  /** Click the table row for one passage; its preview text starts with the heading. */
  async function chooseRow(index: number) {
    const table = screen.getAllByRole('table')[0]
    const rows = within(table).getAllByRole('row').slice(1)
    await userEvent.click(rows[index])
  }

  it('lists them in a table, grouped by the page they came from', async () => {
    renderWithProviders(<AdminPage />, '/admin?document=a&tab=passages')
    await screen.findByText('Passage #0')

    const table = screen.getAllByRole('table')[0]
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)

    // Both passages start on page 1, so one cell spans them and the other is dropped.
    const pageCells = within(table).getAllByText(/^Page 1$/)
    expect(pageCells).toHaveLength(1)
    expect(within(table).getByText('2 passages')).toBeInTheDocument()
  })

  it('shows the page range when a passage spans a break', async () => {
    renderWithProviders(<AdminPage />, '/admin?document=a&tab=passages')
    await screen.findByText('Passage #0')
    await chooseRow(1)
    expect(await screen.findByText('Pages 1–2')).toBeInTheDocument()
  })

  it('selects the first passage so the detail is never empty', async () => {
    const { container } = renderWithProviders(<AdminPage />, '/admin?document=a&tab=passages')
    expect(await screen.findByText('Passage #0')).toBeInTheDocument()
    const detail = container.querySelector('.passage-detail') as HTMLElement
    expect(within(detail).getByText(/在更换滤芯之前/)).toBeInTheDocument()
  })

  it('shows the whole passage when one is chosen', async () => {
    const { container } = renderWithProviders(<AdminPage />, '/admin?document=a&tab=passages')
    await screen.findByText('Passage #0')
    await chooseRow(1)

    expect(await screen.findByText('Passage #1')).toBeInTheDocument()
    const detail = container.querySelector('.passage-detail') as HTMLElement
    expect(within(detail).getByText(/然后拆下外壳/)).toBeInTheDocument()
  })

  it('marks the part repeated from the previous passage', async () => {
    const { container } = renderWithProviders(<AdminPage />, '/admin?document=a&tab=passages')
    await screen.findByText('Passage #0')
    await chooseRow(1)

    const marks = container.querySelectorAll('mark.overlap')
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('必须先关闭主电源开关。')
  })

  it('opens on the passage a search result linked to', async () => {
    renderWithProviders(<AdminPage />, '/admin?document=a&chunk=1&tab=passages')
    expect(await screen.findByText('Passage #1')).toBeInTheDocument()
  })

  it('shows the totals for the document', async () => {
    const { container } = renderWithProviders(<AdminPage />, '/admin?document=a&tab=passages')
    await screen.findByText('Passage #0')
    // "Passages" is also the tab's name, so scope the query to the totals strip.
    const totals = container.querySelector('.passage-totals') as HTMLElement
    expect(within(totals).getByText('2')).toBeInTheDocument()
    expect(within(totals).getByText('420')).toBeInTheDocument()
  })
})
