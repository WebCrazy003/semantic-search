// frontend/src/__tests__/App.test.tsx
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../services/api'
import { makeDocument, makeFolder, makeJob, makeStatus } from './fixtures'
import { clickNav, renderApp } from './helpers'

beforeEach(() => {
  vi.spyOn(api, 'getDocuments').mockResolvedValue([makeDocument()])
  vi.spyOn(api, 'getIndexStatus').mockResolvedValue(makeStatus())
  vi.spyOn(api, 'getJobs').mockResolvedValue([makeJob()])
  vi.spyOn(api, 'getFolders').mockResolvedValue([makeFolder({ is_default: true })])
  vi.spyOn(api, 'fetchReadiness').mockResolvedValue({
    status: 'ready',
    model_loaded: true,
    embedding_device: 'mps',
  })
  vi.spyOn(api, 'getIndexSchema').mockResolvedValue({
    qdrant: {
      collection: 'pdf_passages',
      exists: true,
      vector_size: 1024,
      distance: 'Cosine',
      points_count: 430,
      segments_count: 1,
      status: 'green',
      payload_indexes: ['document_id'],
      payload_fields: [],
    },
    manifest: { path: 'data/manifest.db', tables: [], status_breakdown: { indexed: 1 } },
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
    embedding: { model: 'bge-m3', vector_size: 1024, device: 'mps', max_seq_length: 512 },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('routing', () => {
  it('opens on the hero page, not on search', async () => {
    renderApp()
    expect(
      await screen.findByRole('heading', { name: /find the right passage/i }),
    ).toBeInTheDocument()
  })

  it.each([
    ['/search', /add more documents/i],
    ['/documents', /indexed documents/i],
    ['/settings', /appearance/i],
    ['/admin', /read-only/i],
  ])('renders %s', async (route, marker) => {
    renderApp(route)
    expect(await screen.findByText(marker)).toBeInTheDocument()
  })

  it('sends an unknown route back to the hero', async () => {
    renderApp('/indexing')
    expect(
      await screen.findByRole('heading', { name: /find the right passage/i }),
    ).toBeInTheDocument()
  })

  it('has no tab bar', async () => {
    renderApp()
    await screen.findByRole('heading', { name: /find the right passage/i })
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it.each(['/', '/search', '/documents', '/admin'])(
    'offers the settings button on %s',
    async (route) => {
      renderApp(route)
      expect(await screen.findByRole('button', { name: 'Settings' })).toBeInTheDocument()
    },
  )

  it('reaches settings from the gear', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(await screen.findByText(/appearance/i)).toBeInTheDocument()
  })

  it('polls the library once for every page that needs it', async () => {
    renderApp('/documents')
    await waitFor(() => expect(api.getDocuments).toHaveBeenCalled())
    await clickNav('Search')
    await clickNav('Documents')
    expect(vi.mocked(api.getDocuments).mock.calls.length).toBe(1)
  })
})

describe('state across navigation', () => {
  it('keeps the query and its results', async () => {
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
    renderApp('/search')

    await userEvent.type(screen.getByRole('textbox', { name: /search/i }), '版本控制{Enter}')
    expect(await screen.findAllByText('04_版本控制.pdf')).not.toHaveLength(0)

    await clickNav('Documents')
    await screen.findByText(/indexed documents/i)
    await clickNav('Search')

    expect(screen.getByRole('textbox', { name: /search/i })).toHaveValue('版本控制')
    expect(await screen.findAllByText('04_版本控制.pdf')).not.toHaveLength(0)
    expect(api.search).toHaveBeenCalledTimes(1)
  })
})
