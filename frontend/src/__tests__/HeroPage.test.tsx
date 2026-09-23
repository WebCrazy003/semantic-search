// frontend/src/__tests__/HeroPage.test.tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../services/api'
import { makeDocument, makeStatus } from './fixtures'
import { renderApp } from './helpers'

function givenLibrary(documents: api.DocumentSummary[]) {
  vi.spyOn(api, 'getDocuments').mockResolvedValue(documents)
  vi.spyOn(api, 'getIndexStatus').mockResolvedValue(makeStatus())
  vi.spyOn(api, 'getJobs').mockResolvedValue([])
}

beforeEach(() => {
  givenLibrary([makeDocument({ chunks: 430 }), makeDocument({ document_id: 'b', chunks: 70 })])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HeroPage', () => {
  it('explains what the tool does and that it is local', async () => {
    renderApp()
    expect(await screen.findByRole('heading', { name: /find knowledge locally/i })).toBeVisible()
    expect(screen.getByText(/runs offline, on this machine/i)).toBeInTheDocument()
  })

  it('offers both primary actions', async () => {
    renderApp()
    expect(await screen.findByRole('button', { name: /search documents/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /manage documents/i })).toBeInTheDocument()
  })

  it('goes to the search page', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: /search documents/i }))
    expect(await screen.findByRole('button', { name: /add more documents/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/ask a question/i)).toBeInTheDocument()
  })

  it('goes to the documents page', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: /manage documents/i }))
    expect(await screen.findByText(/indexed documents/i)).toBeInTheDocument()
  })

  it('shows the live library numbers', async () => {
    renderApp()
    expect(await screen.findByText('Documents searchable')).toBeInTheDocument()
    // CountUp animates towards the real figure, so this waits for it to arrive.
    expect(await screen.findByText('500', {}, { timeout: 3000 })).toBeInTheDocument()
  })

  it('names the four things it can do', async () => {
    renderApp()
    expect(await screen.findByText(/finds meaning, not words/i)).toBeInTheDocument()
    expect(screen.getByText(/across languages/i)).toBeInTheDocument()
    expect(screen.getByText('PDF and Word')).toBeInTheDocument()
    expect(screen.getByText(/nothing leaves this machine/i)).toBeInTheDocument()
  })
})

describe('with nothing indexed', () => {
  it('leads with adding documents rather than searching', async () => {
    givenLibrary([])
    renderApp()
    expect(
      await screen.findByRole('button', { name: /add your first documents/i }),
    ).toBeInTheDocument()
  })
})

describe('with the backend down', () => {
  it('says so, and still offers the buttons', async () => {
    vi.spyOn(api, 'getDocuments').mockRejectedValue(new Error('Cannot reach the backend.'))
    vi.spyOn(api, 'getIndexStatus').mockRejectedValue(new Error('Cannot reach the backend.'))
    vi.spyOn(api, 'getJobs').mockRejectedValue(new Error('Cannot reach the backend.'))
    renderApp()
    expect(await screen.findByText(/backend not reachable/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add your first documents/i })).toBeInTheDocument()
  })
})
