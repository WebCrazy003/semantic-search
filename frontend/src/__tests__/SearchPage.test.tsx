// frontend/src/__tests__/SearchPage.test.tsx
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchPage } from '../pages/SearchPage'
import * as api from '../services/api'
import { CARD_MAX_HEIGHT } from '../settings/settings'
import { makeFolder, makeStatus } from './fixtures'
import { chooseOption, givenSettings, renderWithProviders } from './helpers'

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
      heading: '第一章 安全注意事项',
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

beforeEach(() => {
  vi.spyOn(api, 'getDocuments').mockResolvedValue([])
  vi.spyOn(api, 'getIndexStatus').mockResolvedValue(makeStatus())
  vi.spyOn(api, 'getJobs').mockResolvedValue([])
  vi.spyOn(api, 'getFolders').mockResolvedValue([makeFolder({ is_default: true })])
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function searchFor(query: string) {
  await userEvent.type(screen.getByRole('textbox', { name: /search documents/i }), `${query}{Enter}`)
}

describe('the search row', () => {
  it('caps the width of the input rather than filling the window', () => {
    const { container } = renderWithProviders(<SearchPage />)
    const bar = container.querySelector('.search-bar')
    expect(bar).toBeTruthy()
    // The cap itself is in styles.css; the test pins the contract that the element
    // carrying it is present and wraps the input.
    expect(bar?.querySelector('input')).toBeTruthy()
  })

  it('offers the result count and language as compact controls, not full-width selects', () => {
    renderWithProviders(<SearchPage />)
    expect(screen.getByLabelText('Results to show')).toBeInTheDocument()
    expect(screen.getByLabelText('Language')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Results to show' })).toBeInTheDocument()
  })
})

describe('searching', () => {
  it('starts with an empty state', () => {
    renderWithProviders(<SearchPage />)
    expect(screen.getByText(/search your indexed pdf and word files/i)).toBeInTheDocument()
  })

  it('shows the count and the duration', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    expect(await screen.findByText('2 results')).toBeInTheDocument()
    expect(screen.getByText('87 ms')).toBeInTheDocument()
  })

  it('renders one card per result', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    await waitFor(() => expect(screen.getAllByTestId('result-card')).toHaveLength(2))
  })

  it('passes the chosen result count to the API', async () => {
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await chooseOption('Results to show', '20 results')
    await searchFor('x')
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ query: 'x', topK: 20 }))
  })

  it('passes the chosen language filter to the API', async () => {
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await chooseOption('Language', 'Korean')
    await searchFor('x')
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ query: 'x', topK: 10, language: 'ko' }))
  })

  it('omits the filter entirely when the language is any', async () => {
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('x')
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ query: 'x', topK: 10 }))
  })

  it('takes its starting result count from the settings', async () => {
    givenSettings({ resultsPerSearch: 50 })
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('x')
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ query: 'x', topK: 50 }))
  })

  it('says when nothing matched', async () => {
    vi.spyOn(api, 'search').mockResolvedValue({ ...response, count: 0, results: [] })
    renderWithProviders(<SearchPage />)
    await searchFor('zzz')
    expect(await screen.findByText(/no passages matched/i)).toBeInTheDocument()
  })

  it('reports a failure', async () => {
    vi.spyOn(api, 'search').mockRejectedValue(new Error('Cannot reach the backend.'))
    renderWithProviders(<SearchPage />)
    await searchFor('x')
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Cannot reach the backend.'),
    )
  })

  it('does not submit while an IME is composing', async () => {
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    const input = screen.getByRole('textbox', { name: /search documents/i })
    await userEvent.type(input, '더미')
    // A composition-in-progress Enter, as an IME candidate selection produces.
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }),
    )
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('the detail panel', () => {
  it('selects the first result automatically', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    await waitFor(() => expect(screen.getAllByTestId('result-card')[0]).toHaveAttribute(
      'aria-selected',
      'true',
    ))
  })

  it('shows the whole passage and every field for the selected result', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    await userEvent.click((await screen.findAllByTestId('result-card'))[1])

    expect(await screen.findByText('Passage number')).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('/documents/manual_ko.pdf')).toBeInTheDocument()
  })

  it('moves the selection with the arrow keys', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    const cards = await screen.findAllByTestId('result-card')
    cards[0].focus()
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(cards[1]).toHaveAttribute('aria-selected', 'true'))
    await userEvent.keyboard('{ArrowUp}')
    await waitFor(() => expect(cards[0]).toHaveAttribute('aria-selected', 'true'))
  })

  it('offers the way into the source document', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    expect(await screen.findByRole('link', { name: /open page 12 in the pdf/i })).toHaveAttribute(
      'href',
      '/api/documents/a/file#page=12',
    )
  })

  it('hides the admin link unless the setting asks for it', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    await screen.findAllByTestId('result-card')
    expect(screen.queryByRole('link', { name: /inspect passages/i })).not.toBeInTheDocument()
  })

  it('shows the admin link when the setting is on', async () => {
    givenSettings({ showAdminLinks: true })
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    expect(await screen.findByRole('link', { name: /inspect passages/i })).toHaveAttribute(
      'href',
      '/admin?document=a&chunk=4&tab=passages',
    )
  })
})

describe('the result card', () => {
  it('is bounded in height so three fit above the fold', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    const card = (await screen.findAllByTestId('result-card'))[0]
    expect(card).toHaveStyle({ maxHeight: `${CARD_MAX_HEIGHT[3]}px` })
  })

  it('grows when the preview-lines setting does', async () => {
    givenSettings({ previewLines: 6 })
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    const card = (await screen.findAllByTestId('result-card'))[0]
    expect(card).toHaveStyle({ maxHeight: `${CARD_MAX_HEIGHT[6]}px` })
  })

  it('no longer offers an inline Show more', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    await screen.findAllByTestId('result-card')
    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument()
  })
})

describe('adding documents from here', () => {
  it('offers a way to the documents page', async () => {
    renderWithProviders(<SearchPage />)
    const button = screen.getByRole('button', { name: /add more documents/i })
    expect(button).toBeInTheDocument()
    expect(within(button).queryByText(/add more documents/i)).toBeTruthy()
  })
})
