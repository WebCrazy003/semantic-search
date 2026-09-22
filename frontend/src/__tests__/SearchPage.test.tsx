// frontend/src/__tests__/SearchPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchPage } from '../pages/SearchPage'
import * as api from '../services/api'

const response: api.SearchResponse = {
  query: '更换滤芯',
  count: 2,
  took_ms: 87,
  results: [
    {
      score: 0.91,
      document_id: 'a',
      filename: 'manual_zh.pdf',
      filepath: '/documents/manual_zh.pdf',
      page_start: 12,
      page_end: 12,
      chunk_index: 4,
      heading: null,
      language: 'zh',
      text: '在更换滤芯之前，必须先关闭主电源开关。',
    },
    {
      score: 0.83,
      document_id: 'b',
      filename: 'manual_ko.pdf',
      filepath: '/documents/manual_ko.pdf',
      page_start: 7,
      page_end: 7,
      chunk_index: 1,
      heading: null,
      language: 'ko',
      text: '필터를 교체하기 전에 주 전원을 끄십시오.',
    },
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SearchPage', () => {
  it('starts with an empty state and no results', () => {
    render(<SearchPage />)
    expect(screen.getByText(/search your indexed pdf and word files/i)).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('shows the result count and the duration after a search', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    render(<SearchPage />)
    await userEvent.type(screen.getByRole('textbox', { name: /search/i }), '更换滤芯{Enter}')

    // The count is emphasised, so it and the word are separate elements now.
    await waitFor(() =>
      expect(screen.getByText(/results/).textContent?.replace(/\s+/g, ' ')).toContain('2 results'),
    )
    expect(screen.getByText(/87 ms/)).toBeInTheDocument()
  })

  it('renders one entry per result', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    render(<SearchPage />)
    await userEvent.type(screen.getByRole('textbox', { name: /search/i }), '更换滤芯{Enter}')

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
    expect(screen.getByText('manual_zh.pdf')).toBeInTheDocument()
    expect(screen.getByText('manual_ko.pdf')).toBeInTheDocument()
  })

  it('passes the chosen top_k to the API', async () => {
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    render(<SearchPage />)
    await userEvent.selectOptions(screen.getByLabelText(/results to show/i), '20')
    await userEvent.type(screen.getByRole('textbox', { name: /search/i }), 'x{Enter}')
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ query: 'x', topK: 20 }))
  })

  it('passes the chosen language filter to the API', async () => {
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    render(<SearchPage />)
    await userEvent.selectOptions(screen.getByLabelText(/language/i), 'ko')
    await userEvent.type(screen.getByRole('textbox', { name: /search/i }), 'x{Enter}')
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ query: 'x', topK: 10, language: 'ko' }),
    )
  })

  it('omits the filter entirely when the language is set to any', async () => {
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    render(<SearchPage />)
    await userEvent.type(screen.getByRole('textbox', { name: /search/i }), 'x{Enter}')
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ query: 'x', topK: 10 }))
  })

  it('shows a message when nothing matches', async () => {
    vi.spyOn(api, 'search').mockResolvedValue({ ...response, count: 0, results: [] })
    render(<SearchPage />)
    await userEvent.type(screen.getByRole('textbox', { name: /search/i }), 'zzz{Enter}')
    await waitFor(() => expect(screen.getByText(/no passages matched/i)).toBeInTheDocument())
  })

  it('shows the error message when the search fails', async () => {
    vi.spyOn(api, 'search').mockRejectedValue(new Error('Cannot reach the backend.'))
    render(<SearchPage />)
    await userEvent.type(screen.getByRole('textbox', { name: /search/i }), 'x{Enter}')
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Cannot reach the backend.'),
    )
  })

  it('clears a previous error on a successful search', async () => {
    const spy = vi
      .spyOn(api, 'search')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(response)
    render(<SearchPage />)
    const input = screen.getByRole('textbox', { name: /search/i })
    await userEvent.type(input, 'x{Enter}')
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    await userEvent.clear(input)
    await userEvent.type(input, 'y{Enter}')
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
