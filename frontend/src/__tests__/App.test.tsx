// frontend/src/__tests__/App.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import * as api from '../services/api'
import { makeDocument, makeFolder, makeJob, makeStatus } from './fixtures'

beforeEach(() => {
  vi.spyOn(api, 'getDocuments').mockResolvedValue([makeDocument()])
  vi.spyOn(api, 'getIndexStatus').mockResolvedValue(makeStatus())
  vi.spyOn(api, 'getJobs').mockResolvedValue([makeJob()])
  vi.spyOn(api, 'getFolders').mockResolvedValue([makeFolder({ is_default: true })])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('App', () => {
  it('shows the product name', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /semantic pdf search/i })).toBeInTheDocument()
  })

  it('opens on the search tab', () => {
    render(<App />)
    expect(screen.getByRole('textbox', { name: /search/i })).toBeInTheDocument()
  })

  it('switches to the documents tab', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Documents' }))
    expect(await screen.findByText(/manual_zh\.pdf/)).toBeInTheDocument()
  })

  it('switches to the indexing tab', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Indexing' }))
    expect(await screen.findByRole('heading', { name: /^folders$/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /import single pdfs/i })).toBeInTheDocument()
  })

  it('loads the library once for both tabs that need it', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Documents' }))
    await userEvent.click(screen.getByRole('button', { name: 'Indexing' }))
    await waitFor(() => expect(api.getDocuments).toHaveBeenCalled())
    expect(vi.mocked(api.getDocuments).mock.calls.length).toBe(1)
  })
})

describe('state across tab switches', () => {
  it('keeps the search query and its results', async () => {
    vi.spyOn(api, 'search').mockResolvedValue({
      query: '版本控制',
      count: 1,
      took_ms: 42,
      results: [
        {
          score: 0.61,
          document_id: 'a'.repeat(64),
          filename: '04_版本控制.pdf',
          filepath: '/documents/04_版本控制.pdf',
          page_start: 1,
          page_end: 1,
          chunk_index: 0,
          heading: null,
          language: 'zh',
          text: '软件版本控制',
        },
      ],
    })
    render(<App />)

    await userEvent.type(screen.getByRole('textbox', { name: /search/i }), '版本控制{Enter}')
    expect(await screen.findByText('04_版本控制.pdf')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Documents' }))
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(screen.getByRole('textbox', { name: /search/i })).toHaveValue('版本控制')
    expect(screen.getByText('04_版本控制.pdf')).toBeInTheDocument()
    expect(api.search).toHaveBeenCalledTimes(1)
  })

  it('keeps the chosen result count and language filter', async () => {
    render(<App />)
    await userEvent.selectOptions(screen.getByLabelText(/results to show/i), '50')
    await userEvent.selectOptions(screen.getByLabelText(/language/i), 'zh')

    await userEvent.click(screen.getByRole('button', { name: 'Indexing' }))
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(screen.getByLabelText(/results to show/i)).toHaveValue('50')
    expect(screen.getByLabelText(/language/i)).toHaveValue('zh')
  })

  it('keeps files chosen on the indexing tab', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Indexing' }))
    await userEvent.upload(
      screen.getByLabelText(/pdf files to import/i),
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'chosen.pdf', {
        type: 'application/pdf',
      }),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await userEvent.click(screen.getByRole('button', { name: 'Indexing' }))

    expect(screen.getByText(/chosen.pdf/)).toBeInTheDocument()
  })
})
