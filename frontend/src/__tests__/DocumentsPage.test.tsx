// frontend/src/__tests__/DocumentsPage.test.tsx
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentsPage } from '../pages/DocumentsPage'
import * as api from '../services/api'
import { makeDocument, makeFolder, makeJob, makeStatus } from './fixtures'
import { givenSettings, renderWithProviders } from './helpers'

const documents = [
  makeDocument({ document_id: 'a', filename: 'manual_zh.pdf', language: 'zh', chunks: 430 }),
  makeDocument({ document_id: 'b', filename: 'manual_ko.pdf', language: 'ko', chunks: 120 }),
  makeDocument({
    document_id: 'c',
    filename: 'scanned.pdf',
    status: 'unsupported',
    chunks: 0,
    error_message: 'no extractable text',
  }),
]

function givenLibrary(overrides: Partial<api.IndexStatus> = {}, docs = documents) {
  vi.spyOn(api, 'getDocuments').mockResolvedValue(docs)
  vi.spyOn(api, 'getIndexStatus').mockResolvedValue(makeStatus(overrides))
  vi.spyOn(api, 'getJobs').mockResolvedValue([makeJob()])
  vi.spyOn(api, 'getFolders').mockResolvedValue([makeFolder({ is_default: true })])
  vi.spyOn(api, 'fetchReadiness').mockResolvedValue({
    status: 'ready',
    model_loaded: true,
    embedding_device: 'mps',
  })
}

beforeEach(() => givenLibrary())

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * The page has loaded when the table has its rows. A filename alone is ambiguous: it
 * also appears in the largest-documents chart and in that chart's screen-reader table.
 */
async function ready() {
  return screen.findByRole('link', { name: /manual_zh\.pdf/ })
}

describe('the document list', () => {
  it('lists every known document', async () => {
    renderWithProviders(<DocumentsPage />)
    expect(await ready()).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /manual_ko\.pdf/ })).toBeInTheDocument()
    expect(screen.getByText('scanned.pdf')).toBeInTheDocument()
  })

  it('shows why a document is not searchable', async () => {
    renderWithProviders(<DocumentsPage />)
    expect(await screen.findByText('no extractable text')).toBeInTheDocument()
  })
})

describe('the aggregate diagrams', () => {
  it('shows the headline numbers', async () => {
    renderWithProviders(<DocumentsPage />)
    await ready()
    const library = screen.getByText('Library').closest('.ant-card') as HTMLElement
    expect(within(library).getByText('Searchable')).toBeInTheDocument()
    // 430 + 120 passages from the two indexed documents.
    // CountUp animates towards the real figure, so this waits for it to arrive.
    expect(await within(library).findByText('550', {}, { timeout: 3000 })).toBeInTheDocument()
  })

  it('breaks the library down by status, in words as well as colour', async () => {
    renderWithProviders(<DocumentsPage />)
    await ready()
    const card = screen.getByText('By status').closest('.ant-card') as HTMLElement
    const table = within(card).getByRole('table')
    expect(within(table).getByRole('rowheader', { name: 'indexed' })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: 'unsupported' })).toBeInTheDocument()
  })

  it('breaks the searchable documents down by language', async () => {
    renderWithProviders(<DocumentsPage />)
    await ready()
    const card = screen.getByText('By language').closest('.ant-card') as HTMLElement
    const table = within(card).getByRole('table')
    expect(within(table).getByRole('rowheader', { name: 'Chinese' })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: 'Korean' })).toBeInTheDocument()
  })

  it('names the largest documents by passage count', async () => {
    renderWithProviders(<DocumentsPage />)
    await ready()
    const card = screen.getByText('Largest documents').closest('.ant-card') as HTMLElement
    const table = within(card).getByRole('table')
    expect(within(table).getByRole('rowheader', { name: 'manual_zh.pdf' })).toBeInTheDocument()
  })

  it('describes every chart to a screen reader', async () => {
    renderWithProviders(<DocumentsPage />)
    await ready()
    expect(screen.getByRole('img', { name: /documents by status/i })).toBeInTheDocument()
  })
})

describe('adding documents', () => {
  it('minimises the diagrams and opens the add card', async () => {
    renderWithProviders(<DocumentsPage />)
    await ready()
    expect(screen.queryByTestId('add-documents-card')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /add documents/i }))

    const wrap = screen.getByTestId('aggregate-wrap')
    expect(wrap).toHaveClass('minimised')
    // Animations are on by default, so it transitions rather than jumping.
    expect(wrap).not.toHaveClass('no-motion')
    expect(await screen.findByTestId('add-documents-card')).toBeInTheDocument()
    expect(screen.getByTestId('aggregate-strip')).toBeInTheDocument()
  })

  it('keeps the numbers visible in the minimised strip', async () => {
    renderWithProviders(<DocumentsPage />)
    await ready()
    await userEvent.click(screen.getByRole('button', { name: /add documents/i }))
    const strip = screen.getByTestId('aggregate-strip')
    expect(within(strip).getByText('550')).toBeInTheDocument()
  })

  it('restores the diagrams', async () => {
    renderWithProviders(<DocumentsPage />)
    await ready()
    await userEvent.click(screen.getByRole('button', { name: /add documents/i }))
    await userEvent.click(screen.getByRole('button', { name: /show summary/i }))
    expect(screen.getByTestId('aggregate-wrap')).not.toHaveClass('minimised')
    expect(screen.queryByTestId('add-documents-card')).not.toBeInTheDocument()
  })

  it('skips the transition when animations are off', async () => {
    givenSettings({ animations: false })
    renderWithProviders(<DocumentsPage />)
    await ready()
    await userEvent.click(screen.getByRole('button', { name: /add documents/i }))
    const wrap = screen.getByTestId('aggregate-wrap')
    expect(wrap).toHaveClass('minimised')
    expect(wrap).toHaveClass('no-motion')
  })

  it('carries folders, import and indexing, so nothing from the old tab is lost', async () => {
    renderWithProviders(<DocumentsPage />)
    await ready()
    await userEvent.click(screen.getByRole('button', { name: /add documents/i }))
    const card = await screen.findByTestId('add-documents-card')

    expect(within(card).getByLabelText(/folder path/i)).toBeInTheDocument()
    expect(within(card).getByText(/drop pdf or word files here/i)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /index documents/i })).toBeInTheDocument()
    expect(within(card).getByText(/recent jobs/i)).toBeInTheDocument()
  })

  it('registers a folder', async () => {
    const add = vi.spyOn(api, 'addFolder').mockResolvedValue(makeFolder())
    vi.spyOn(api, 'startIndexing').mockResolvedValue({ status: 'started', directory: '/documents' })
    renderWithProviders(<DocumentsPage />)
    await ready()
    await userEvent.click(screen.getByRole('button', { name: /add documents/i }))

    await userEvent.type(screen.getByLabelText(/folder path/i), '/Users/you/manuals')
    await userEvent.click(screen.getByRole('button', { name: /add folder/i }))
    await waitFor(() => expect(add).toHaveBeenCalledWith('/Users/you/manuals'))
  })

  it('starts an indexing job', async () => {
    const start = vi
      .spyOn(api, 'startIndexing')
      .mockResolvedValue({ status: 'started', directory: '/documents' })
    renderWithProviders(<DocumentsPage />)
    await ready()
    await userEvent.click(screen.getByRole('button', { name: /add documents/i }))
    await userEvent.click(screen.getByRole('button', { name: /index documents/i }))
    await waitFor(() => expect(start).toHaveBeenCalled())
  })
})

describe('while a job runs', () => {
  it('shows live progress', async () => {
    givenLibrary({
      status: 'running',
      total_documents: 10,
      processed_documents: 4,
      current_file: 'manual_ko.pdf',
      current_stage: 'embedding',
      indexed_documents: 4,
      total_chunks: 220,
    })
    renderWithProviders(<DocumentsPage />)
    await ready()
    await userEvent.click(screen.getByRole('button', { name: /add documents/i }))

    expect(await screen.findByText(/4 of 10 files checked/i)).toBeInTheDocument()
    expect(screen.getByText('manual_ko.pdf', { selector: '.current-file' })).toBeInTheDocument()
    expect(screen.getByText(/embedding/)).toBeInTheDocument()
  })

  it('says the list is updating', async () => {
    givenLibrary({ status: 'running', total_documents: 10, processed_documents: 4 })
    renderWithProviders(<DocumentsPage />)
    expect(await screen.findByText(/this list updates as it goes/i)).toBeInTheDocument()
  })
})

describe('clearing the index', () => {
  it('asks before clearing, then clears', async () => {
    const clear = vi
      .spyOn(api, 'clearIndex')
      .mockResolvedValue({ documents_removed: 3, passages_removed: 550, files_kept: true })
    renderWithProviders(<DocumentsPage />)
    await ready()

    await userEvent.click(screen.getByRole('button', { name: /clear all indexing/i }))
    expect(await screen.findByText(/will stop being searchable/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /yes, clear it/i }))
    await waitFor(() => expect(clear).toHaveBeenCalled())
  })
})

describe('getting back to search', () => {
  it('offers a way', async () => {
    renderWithProviders(<DocumentsPage />)
    await ready()
    expect(screen.getByRole('button', { name: /^search$/i })).toBeInTheDocument()
  })
})
