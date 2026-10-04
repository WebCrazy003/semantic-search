// frontend/src/__tests__/SearchPage.test.tsx
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as passage from '../components/passage'
import { SearchPage } from '../pages/SearchPage'
import * as api from '../services/api'
import { CARD_MAX_HEIGHT } from '../settings/settings'
import { makeStatus } from './fixtures'
import {
  chooseOption,
  givenAnswers,
  givenSettings,
  mockAsk,
  renderWithProviders,
  untilAborted,
} from './helpers'

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
  givenAnswers(false)
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
    expect(
      screen.getByText(/ask a question or search your pdf and word files/i),
    ).toBeInTheDocument()
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

describe('answers', () => {
  function answering() {
    return mockAsk((handlers) => {
      handlers.onResults(response)
      handlers.onSources({
        language: 'zh-Hans',
        unsupported: false,
        passages: [{ n: 1, document_id: 'b', chunk_index: 1 }],
      })
      handlers.onDelta('先关闭主电源[1]。')
      handlers.onDone({ status: 'answered', answer_ms: 900, model: 'm', restarted: false })
    })
  }

  it('puts the answer above the results when the backend can answer', async () => {
    givenAnswers(true)
    const askSpy = answering()
    const searchSpy = vi.spyOn(api, 'search').mockResolvedValue(response)
    const { container } = renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')

    const panel = await screen.findByRole('region', { name: 'Answer' })
    expect(await within(panel).findByTestId('answer-text')).toHaveTextContent('先关闭主电源1。')
    expect(screen.getAllByTestId('result-card')).toHaveLength(2)
    const list = container.querySelector('.result-list') as HTMLElement
    expect(panel.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(askSpy).toHaveBeenCalledWith({ query: '更换滤芯', topK: 10 }, expect.anything(), expect.anything())
    expect(searchSpy).not.toHaveBeenCalled()
    // The result list is a plain search's: nothing opens by itself.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('frees the search box as soon as the results arrive', async () => {
    givenAnswers(true)
    mockAsk(async (handlers, signal) => {
      handlers.onResults(response)
      handlers.onDelta('写到一半')
      await untilAborted(signal)
    })
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    await screen.findByTestId('answer-text')
    expect(screen.getByRole('button', { name: /^search$/i })).not.toHaveClass('ant-btn-loading')
  })

  it('cancels the answer still being written when a new search starts', async () => {
    givenAnswers(true)
    const signals: (AbortSignal | undefined)[] = []
    mockAsk(async (handlers, signal) => {
      signals.push(signal)
      handlers.onResults(response)
      await untilAborted(signal)
    })
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    await waitFor(() => expect(signals).toHaveLength(1))
    await searchFor(' again')
    await waitFor(() => expect(signals).toHaveLength(2))
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
  })

  it('searches plainly when the backend has no answer model', async () => {
    const askSpy = answering()
    const searchSpy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    await waitFor(() => expect(screen.getAllByTestId('result-card')).toHaveLength(2))
    expect(searchSpy).toHaveBeenCalledOnce()
    expect(askSpy).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Answer' })).not.toBeInTheDocument()
  })

  it('searches plainly against an older backend that does not mention answers', async () => {
    vi.spyOn(api, 'fetchReadiness').mockResolvedValue({ status: 'ready', model_loaded: true })
    const askSpy = answering()
    const searchSpy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    await waitFor(() => expect(searchSpy).toHaveBeenCalledOnce())
    expect(askSpy).not.toHaveBeenCalled()
  })

  it('searches plainly when the reader turned answers off', async () => {
    givenSettings({ answersEnabled: false })
    const readiness = givenAnswers(true)
    const askSpy = answering()
    const searchSpy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    await waitFor(() => expect(screen.getAllByTestId('result-card')).toHaveLength(2))
    expect(searchSpy).toHaveBeenCalledOnce()
    expect(askSpy).not.toHaveBeenCalled()
    expect(readiness).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Answer' })).not.toBeInTheDocument()
  })

  it('falls back to a plain search when asking fails before any results', async () => {
    givenAnswers(true)
    const askSpy = vi.spyOn(api, 'ask').mockRejectedValue(new Error('Not Found'))
    const searchSpy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await chooseOption('Language', 'Korean')
    await searchFor('更换滤芯')

    await waitFor(() => expect(screen.getAllByTestId('result-card')).toHaveLength(2))
    expect(askSpy).toHaveBeenCalledOnce()
    expect(searchSpy).toHaveBeenCalledWith({ query: '更换滤芯', topK: 10, language: 'ko' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Answer' })).not.toBeInTheDocument()
  })

  it('asks the backend again, at most every 30 seconds, while answers are unavailable', async () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const readiness = givenAnswers(false)
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await waitFor(() => expect(readiness).toHaveBeenCalledTimes(1))

    await searchFor('a')
    await waitFor(() => expect(api.search).toHaveBeenCalledTimes(1))
    expect(readiness).toHaveBeenCalledTimes(1)

    // The model has started since. This search does not wait to find out: it searches
    // plainly and refreshes readiness in the background, for the next one.
    now += 31_000
    givenAnswers(true)
    const askSpy = answering()
    await searchFor('b')
    await waitFor(() => expect(api.search).toHaveBeenCalledTimes(2))
    expect(askSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(readiness).toHaveBeenCalledTimes(2))

    await searchFor('c')
    await waitFor(() => expect(askSpy).toHaveBeenCalledOnce())
    expect(api.search).toHaveBeenCalledTimes(2)
  })

  it('never waits for the readiness check before searching', async () => {
    vi.spyOn(api, 'fetchReadiness').mockReturnValue(new Promise(() => undefined))
    const askSpy = answering()
    const searchSpy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    await waitFor(() => expect(screen.getAllByTestId('result-card')).toHaveLength(2))
    expect(searchSpy).toHaveBeenCalledOnce()
    expect(askSpy).not.toHaveBeenCalled()
  })

  it('goes back to plain searches when the answer model becomes unavailable', async () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const readiness = givenAnswers(true)
    const askSpy = mockAsk((handlers) => {
      handlers.onResults(response)
      handlers.onError({ code: 'unavailable', message: 'The answer model is not responding.' })
    })
    const searchSpy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await waitFor(() => expect(readiness).toHaveBeenCalledOnce())

    await searchFor('a')
    expect(await screen.findByText(/the answer model is not responding/i)).toBeInTheDocument()

    // The next search does not show the same error again: it is a plain search.
    await searchFor('b')
    await waitFor(() => expect(searchSpy).toHaveBeenCalledOnce())
    expect(askSpy).toHaveBeenCalledOnce()
    expect(screen.queryByRole('region', { name: 'Answer' })).not.toBeInTheDocument()

    // Later, readiness is asked again, and answers come back once it says so.
    now += 31_000
    await searchFor('c')
    await waitFor(() => expect(readiness).toHaveBeenCalledTimes(2))
    await searchFor('d')
    await waitFor(() => expect(askSpy).toHaveBeenCalledTimes(2))
  })

  it('keeps asking after an answer that failed for another reason', async () => {
    givenAnswers(true)
    const askSpy = mockAsk((handlers) => {
      handlers.onResults(response)
      handlers.onError({ code: 'failed', message: 'The model wrote nothing.' })
    })
    const searchSpy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderWithProviders(<SearchPage />)
    await searchFor('a')
    expect(await screen.findByText('The model wrote nothing.')).toBeInTheDocument()
    await searchFor('b')
    await waitFor(() => expect(askSpy).toHaveBeenCalledTimes(2))
    expect(searchSpy).not.toHaveBeenCalled()
  })

  it('does not re-render the result cards for every streamed word', async () => {
    givenAnswers(true)
    let write: (text: string) => void = () => undefined
    mockAsk(async (handlers, signal) => {
      handlers.onResults(response)
      handlers.onSources({
        language: 'zh-Hans',
        unsupported: false,
        passages: [{ n: 1, document_id: 'b', chunk_index: 1 }],
      })
      write = handlers.onDelta
      await untilAborted(signal)
    })
    const highlightSpy = vi.spyOn(passage, 'highlight')
    renderWithProviders(<SearchPage />)
    await searchFor('更换滤芯')
    write('先关闭')
    await screen.findByTestId('answer-text')
    const before = highlightSpy.mock.calls.length
    expect(before).toBeGreaterThan(0)

    write('主电源')
    write('开关')
    await waitFor(() => expect(screen.getByTestId('answer-text')).toHaveTextContent('先关闭主电源开关'))
    expect(highlightSpy.mock.calls.length).toBe(before)

    // A new citation does reach the cited card, for its badge.
    write('[1]。')
    const cards = screen.getAllByTestId('result-card')
    expect(await within(cards[1]).findByText('[1]')).toBeInTheDocument()
  })
})
