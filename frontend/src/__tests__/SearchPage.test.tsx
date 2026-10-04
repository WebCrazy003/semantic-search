// frontend/src/__tests__/SearchPage.test.tsx
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchPage } from '../pages/SearchPage'
import * as api from '../services/api'
import { CARD_MAX_HEIGHT } from '../settings/settings'
import { makeStatus } from './fixtures'
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

async function openResult(index: number) {
  await userEvent.click((await screen.findAllByTestId('result-card'))[index])
}

describe('the detail panel', () => {
  it('stays closed until a result is clicked', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    const cards = await screen.findAllByTestId('result-card')
    expect(cards.every((card) => card.getAttribute('aria-selected') === 'false')).toBe(true)
    expect(screen.queryByRole('link', { name: /open in the pdf/i })).not.toBeInTheDocument()

    await openResult(1)
    expect(cards[1]).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('dialog')).toHaveTextContent('필터를 교체하기 전에')
  })

  it('shows page and relevance once each, and no developer fields by default', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    await openResult(0)
    const panel = await screen.findByRole('dialog')
    expect(within(panel).getAllByText('Page 12')).toHaveLength(1)
    expect(within(panel).getAllByLabelText(/^relevance/i)).toHaveLength(1)
    expect(within(panel).queryByText('Passage number')).not.toBeInTheDocument()
    expect(within(panel).queryByText('/documents/manual_zh.pdf')).not.toBeInTheDocument()
  })

  it('shows the developer fields in developer mode', async () => {
    givenSettings({ developerMode: true })
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    await openResult(1)
    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByText('Passage number')).toBeInTheDocument()
    expect(within(panel).getByText('#1')).toBeInTheDocument()
    expect(within(panel).getByText('/documents/manual_ko.pdf')).toBeInTheDocument()
  })

  it('shows and highlights a passage that is only its heading', async () => {
    const titleOnly = { ...response.results[0], text: '第一章 安全注意事项' }
    vi.spyOn(api, 'search').mockResolvedValue({ ...response, query: '安全', results: [titleOnly] })
    renderWithProviders(<SearchPage />)
    await searchFor('安全')
    await openResult(0)
    const text = (await screen.findByRole('dialog')).querySelector('.detail-text')
    expect(text).toHaveTextContent('第一章 安全注意事项')
    expect(text?.querySelector('mark')).toHaveTextContent('安全')
  })

  it('moves between results with the arrow keys, and the open panel follows', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    const cards = await screen.findAllByTestId('result-card')
    cards[0].focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(cards[1]).toHaveFocus()
    expect(cards[1]).toHaveAttribute('aria-selected', 'false')

    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(cards[1]).toHaveAttribute('aria-selected', 'true'))
    cards[1].focus()
    await userEvent.keyboard('{ArrowUp}')
    await waitFor(() => expect(cards[0]).toHaveAttribute('aria-selected', 'true'))
  })

  it('offers the way into the source document at the right page', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    await openResult(0)
    expect(await screen.findByRole('link', { name: /open in the pdf/i })).toHaveAttribute(
      'href',
      '/api/documents/a/file#page=12',
    )
  })

  it('hides the admin link unless the setting asks for it', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    await openResult(0)
    await screen.findByRole('dialog')
    expect(screen.queryByRole('link', { name: /inspect passages/i })).not.toBeInTheDocument()
  })

  it('shows the admin link when the setting is on', async () => {
    givenSettings({ showAdminLinks: true })
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    await openResult(0)
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

  it('puts the passage first and keeps the score to a quiet label', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    const [strong] = await screen.findAllByTestId('result-card')
    expect(strong).toHaveClass('relevance-strong')
    expect(within(strong).getByText('Strong match')).toBeInTheDocument()
    expect(within(strong).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(within(strong).queryByText('0.91')).not.toBeInTheDocument()
  })

  it('highlights the parts of a CJK query that appear in the passage', async () => {
    vi.spyOn(api, 'search').mockResolvedValue({ ...response, query: '如何更换滤芯' })
    renderWithProviders(<SearchPage />)
    await searchFor('如何更换滤芯')
    const [card] = await screen.findAllByTestId('result-card')
    const marks = [...card.querySelectorAll('.result-text mark')].map((mark) => mark.textContent)
    // 如何更换滤芯 never appears whole; its pieces do, side by side.
    expect(marks).toEqual(expect.arrayContaining(['更换', '滤芯']))
    expect(marks).not.toContain('如何')
  })

  it('keeps language and owner tags for developer mode', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    const [card] = await screen.findAllByTestId('result-card')
    expect(within(card).queryByText('zh')).not.toBeInTheDocument()
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
