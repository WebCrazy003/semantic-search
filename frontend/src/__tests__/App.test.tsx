// frontend/src/__tests__/App.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import * as api from '../services/api'

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
    vi.spyOn(api, 'getDocuments').mockResolvedValue([])
    vi.spyOn(api, 'getIndexStatus').mockResolvedValue({
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
    })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /documents/i }))
    expect(await screen.findByRole('button', { name: /index documents/i })).toBeInTheDocument()
  })
})
