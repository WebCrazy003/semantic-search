// frontend/src/__tests__/App.test.tsx
// Routes, the shell around them and the redirects for old bookmarks (spec 2026-10-08
// §1.4).
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../services/api'
import { makeDocument, makeJob, makeStatus } from './fixtures'
import { currentLocation, loggedOut, renderApp, renderResults, searchFor } from './helpers'

beforeEach(() => {
  vi.spyOn(api, 'getDocuments').mockResolvedValue([makeDocument()])
  vi.spyOn(api, 'getIndexStatus').mockResolvedValue(makeStatus())
  vi.spyOn(api, 'getJobs').mockResolvedValue([makeJob()])
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

const result: api.SearchResponse = {
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
}

describe('routing', () => {
  it('opens on the home page', async () => {
    renderApp()
    expect(await screen.findByRole('heading', { name: 'DocSage' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search documents' })).toBeInTheDocument()
  })

  it.each([
    ['/search?q=x', '04_版本控制.pdf'],
    ['/drive', /drop pdf or word files here/i],
    ['/admin', /read-only/i],
  ])('renders %s', async (route, marker) => {
    vi.spyOn(api, 'search').mockResolvedValue(result)
    renderApp(route)
    expect(await screen.findByText(marker)).toBeInTheDocument()
  })

  it('sends /search without a query to the home page', async () => {
    renderApp('/search')
    expect(await screen.findByRole('heading', { name: 'DocSage' })).toBeInTheDocument()
    expect(currentLocation()).toBe('/')
  })

  it('sends an unknown route to the home page', async () => {
    renderApp('/indexing')
    expect(await screen.findByRole('heading', { name: 'DocSage' })).toBeInTheDocument()
    expect(currentLocation()).toBe('/')
  })

  it('has no tab bar and no navigation buttons', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(result)
    renderResults('x')
    await screen.findByText('04_版本控制.pdf')
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Documents' })).not.toBeInTheDocument()
  })

  it.each(['/', '/search?q=x', '/drive', '/admin'])(
    'offers the settings button on %s',
    async (route) => {
      vi.spyOn(api, 'search').mockResolvedValue(result)
      renderApp(route)
      expect(await screen.findByRole('button', { name: 'Settings' })).toBeInTheDocument()
    },
  )

  it('reaches settings from the gear', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    expect(within(dialog).getByText(/appearance/i)).toBeInTheDocument()
  })

  it('polls the library once when the drive opens', async () => {
    renderApp('/drive')
    await screen.findByText(/drop pdf or word files here/i)
    await waitFor(() => expect(api.getDocuments).toHaveBeenCalled())
    expect(vi.mocked(api.getDocuments).mock.calls.length).toBe(1)
  })

  it('does not ask for the library on the home or results pages', async () => {
    // A visitor could not read it; search needs only the search endpoint.
    vi.spyOn(api, 'search').mockResolvedValue(result)
    renderApp()
    await searchFor('版本控制')
    await screen.findByText('04_版本控制.pdf')
    expect(api.getDocuments).not.toHaveBeenCalled()
  })
})

describe('the header', () => {
  it('shows the search box only on the results page', async () => {
    renderApp('/drive')
    await screen.findByText(/drop pdf or word files here/i)
    expect(screen.queryByRole('textbox', { name: 'Search documents' })).not.toBeInTheDocument()
  })

  it('goes home from the wordmark', async () => {
    renderApp('/drive')
    await screen.findByText(/drop pdf or word files here/i)
    await userEvent.click(screen.getByRole('link', { name: /go to the start page/i }))
    expect(await screen.findByRole('heading', { name: 'DocSage' })).toBeInTheDocument()
    expect(currentLocation()).toBe('/')
  })
})

describe('the drive', () => {
  it('asks a visitor to log in, over an empty page', async () => {
    loggedOut()
    renderApp('/drive')
    expect(await screen.findByText('Log in to manage your documents')).toBeInTheDocument()
    // The dialog opens by itself, as a login page would have.
    expect(await screen.findByRole('heading', { name: 'Log in to DocSage' })).toBeInTheDocument()
    expect(screen.queryByText(/drop pdf or word files here/i)).not.toBeInTheDocument()
  })
})

describe('old routes, kept for bookmarks', () => {
  it.each([
    ['/login', 'Log in to DocSage'],
    ['/register', 'Create an account'],
    ['/forgot-password', 'Reset your password'],
  ])('%s opens its dialog over the home page', async (route, heading) => {
    loggedOut()
    renderApp(route)
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'DocSage' })).toBeInTheDocument()
    // The ?dialog= parameter is dropped, so a reload does not reopen it.
    await waitFor(() => expect(currentLocation()).toBe('/'))
  })

  it('/settings opens the settings dialog over the home page', async () => {
    renderApp('/settings')
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    await waitFor(() => expect(currentLocation()).toBe('/'))
  })

  it('/account/password opens the change-password dialog', async () => {
    renderApp('/account/password')
    expect(
      await screen.findByRole('heading', { name: 'Change your password' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(currentLocation()).toBe('/'))
  })

  it('/setup goes to the home page', async () => {
    renderApp('/setup')
    expect(await screen.findByRole('heading', { name: 'DocSage' })).toBeInTheDocument()
    expect(currentLocation()).toBe('/')
  })

  it('/documents goes to the drive', async () => {
    renderApp('/documents')
    expect(await screen.findByText(/drop pdf or word files here/i)).toBeInTheDocument()
    expect(currentLocation()).toBe('/drive')
  })

  it('does not open a login dialog for someone already logged in', async () => {
    renderApp('/login')
    await screen.findByRole('button', { name: 'Account: boss' })
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Log in to DocSage' })).not.toBeInTheDocument(),
    )
  })
})

describe('state across navigation', () => {
  it('keeps the query and its results', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(result)
    renderApp()
    await searchFor('版本控制')
    expect(await screen.findAllByText('04_版本控制.pdf')).not.toHaveLength(0)

    // Off to the admin tools and home again, then the same search.
    await userEvent.click(screen.getByRole('button', { name: 'Account: boss' }))
    await userEvent.click(await screen.findByText('Admin tools'))
    await screen.findByText(/read-only/i)
    await userEvent.click(screen.getByRole('link', { name: /go to the start page/i }))
    await searchFor('版本控制')

    expect(screen.getByRole('textbox', { name: 'Search documents' })).toHaveValue('版本控制')
    expect(await screen.findAllByText('04_版本控制.pdf')).not.toHaveLength(0)
    expect(api.search).toHaveBeenCalledTimes(1)
  })
})
