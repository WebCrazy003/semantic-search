// frontend/src/__tests__/SearchPage.test.tsx
// The results page, reached as a reader reaches it: a query typed on the home page, or a
// results address opened directly. The search box is the app's (home or header), not
// the page's, so these render the whole app.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as passage from '../components/passage'
import * as api from '../services/api'
import { CARD_MAX_HEIGHT } from '../settings/settings'
import { makeStatus } from './fixtures'

// jsdom cannot render a PDF (no canvas, no worker), so the view is a stub that shows
// what it was asked to find. The real matcher has its own tests (src/viewer).
vi.mock('../viewer/PdfView', () => ({
  default: (props: { target: { pageStart: number; text: string } | null }) => (
    <div
      data-testid="pdf-stub"
      data-page={props.target?.pageStart}
      data-passage={props.target?.text}
    />
  ),
}))
import {
  USER,
  asUser,
  chooseOption,
  currentLocation,
  findDialog,
  givenAnswers,
  givenSettings,
  goBack,
  loggedOut,
  mockAsk,
  renderApp,
  renderResults,
  searchFor,
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

describe('the search row', () => {
  it('caps the width of the input rather than filling the window', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    const { container } = renderResults('更换滤芯')
    await screen.findAllByTestId('result-card')
    const bar = container.querySelector('.topbar .search-bar')
    expect(bar).toBeTruthy()
    // The cap itself is in styles.css; the test pins the contract that the element
    // carrying it is present and wraps the input.
    expect(bar?.querySelector('input')).toBeTruthy()
  })

  it('offers the result count and language as compact controls, not full-width selects', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderResults('更换滤芯')
    expect(await screen.findByLabelText('Results to show')).toBeInTheDocument()
    expect(screen.getByLabelText('Language')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Results to show' })).toBeInTheDocument()
  })
})

describe('the query in the address', () => {
  it('goes from the home page to the results for what was typed', async () => {
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    await waitFor(() => expect(screen.getAllByTestId('result-card')).toHaveLength(2))
    expect(currentLocation()).toBe(`/search?q=${encodeURIComponent('更换滤芯')}`)
    expect(spy).toHaveBeenCalledWith({ query: '更换滤芯', topK: 10 })
  })

  it('runs the search a results address names, once, as whoever is logged in', async () => {
    // A bookmark or a new tab: the session is still loading when the page mounts.
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderResults('更换滤芯')
    await waitFor(() => expect(screen.getAllByTestId('result-card')).toHaveLength(2))
    // Give a second, redundant search the chance to happen before counting.
    await screen.findByRole('button', { name: 'Account: boss' })
    expect(spy).toHaveBeenCalledOnce()
  })

  it('shows the query in the header box', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderResults('更换滤芯')
    expect(await screen.findByRole('textbox', { name: /search documents/i })).toHaveValue('更换滤芯')
  })

  it('replaces the query when a new one is typed in the header', async () => {
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderResults('更换滤芯')
    await screen.findAllByTestId('result-card')
    await searchFor('필터')
    expect(currentLocation()).toBe(`/search?q=${encodeURIComponent('필터')}`)
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ query: '필터', topK: 10 }))
  })

  it('searches again when the same query is submitted again', async () => {
    // The address does not change, so only the box itself can start it.
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    await searchFor('更换滤芯')
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  })

  it('goes back to the previous search with Back', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('first')
    await searchFor('second')
    await goBack()
    expect(currentLocation()).toBe('/search?q=first')
    expect(screen.getByRole('textbox', { name: /search documents/i })).toHaveValue('first')
    await waitFor(() => expect(api.search).toHaveBeenLastCalledWith({ query: 'first', topK: 10 }))
  })

  it('sends a results address without a query to the home page', async () => {
    renderApp('/search')
    expect(await screen.findByRole('heading', { name: 'DocSage' })).toBeInTheDocument()
    expect(currentLocation()).toBe('/')
  })
})

describe('searching', () => {

  it('shows the count and the duration', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    expect(await screen.findByText('2 results')).toBeInTheDocument()
    expect(screen.getByText('87 ms')).toBeInTheDocument()
  })

  it('renders one card per result', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    await waitFor(() => expect(screen.getAllByTestId('result-card')).toHaveLength(2))
  })

  it('passes the chosen result count to the API', async () => {
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderResults('更换滤芯')
    await chooseOption('Results to show', '20 results')
    await searchFor('x')
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ query: 'x', topK: 20 }))
  })

  it('passes the chosen language filter to the API', async () => {
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderResults('更换滤芯')
    await chooseOption('Language', 'Korean')
    await searchFor('x')
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ query: 'x', topK: 10, language: 'ko' }))
  })

  it('omits the filter entirely when the language is any', async () => {
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('x')
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ query: 'x', topK: 10 }))
  })

  it('takes its starting result count from the settings', async () => {
    givenSettings({ resultsPerSearch: 50 })
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('x')
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ query: 'x', topK: 50 }))
  })

  it('says when nothing matched', async () => {
    vi.spyOn(api, 'search').mockResolvedValue({ ...response, count: 0, results: [] })
    renderApp()
    await searchFor('zzz')
    expect(await screen.findByText(/no passages matched/i)).toBeInTheDocument()
  })

  it('reports a failure', async () => {
    vi.spyOn(api, 'search').mockRejectedValue(new Error('Cannot reach the backend.'))
    renderApp()
    await searchFor('x')
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Cannot reach the backend.'),
    )
  })

  it('does not submit while an IME is composing', async () => {
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    const input = screen.getByRole('textbox', { name: /search documents/i })
    await userEvent.type(input, '더미')
    // A composition-in-progress Enter, as an IME candidate selection produces.
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }),
    )
    expect(spy).not.toHaveBeenCalled()
    expect(currentLocation()).toBe('/')
  })
})

async function openResult(index: number) {
  await userEvent.click((await screen.findAllByTestId('result-card'))[index])
}

/** A file the viewer can show: a PDF, rendered by the stub below. */
function givenFile(kind: api.DocumentFile['kind'] = 'pdf') {
  return vi
    .spyOn(api, 'fetchDocumentFile')
    .mockResolvedValue({ data: new ArrayBuffer(8), kind, filename: 'manual_zh.pdf' })
}

describe('the detail panel', () => {
  beforeEach(() => {
    givenFile()
  })

  it('stays closed until a result is clicked', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    const cards = await screen.findAllByTestId('result-card')
    expect(cards.every((card) => card.getAttribute('aria-selected') === 'false')).toBe(true)
    expect(screen.queryByTestId('document-viewer')).not.toBeInTheDocument()

    await openResult(1)
    expect(cards[1]).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByTestId('document-viewer')).toBeInTheDocument()
  })

  it('shows the document itself, at the passage, rather than the passage text', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    await openResult(0)
    const stub = await screen.findByTestId('pdf-stub')
    expect(stub).toHaveAttribute('data-page', '12')
    expect(stub).toHaveAttribute('data-passage', '在更换滤芯之前，必须先关闭主电源开关。')
    expect(api.fetchDocumentFile).toHaveBeenCalledWith('a', expect.anything())
    const panel = await screen.findByRole('dialog')
    expect(panel.querySelector('.detail-text')).toBeNull()
    expect(within(panel).queryByLabelText(/^relevance/i)).not.toBeInTheDocument()
  })

  it('downloads the file once for two passages of the same document', async () => {
    const second = { ...response.results[0], chunk_index: 5, page_start: 13, page_end: 13 }
    vi.spyOn(api, 'search').mockResolvedValue({
      ...response,
      results: [response.results[0], second],
    })
    renderApp()
    await searchFor('更换滤芯')
    await openResult(0)
    await screen.findByTestId('pdf-stub')
    await openResult(1)
    await waitFor(() => expect(screen.getByTestId('pdf-stub')).toHaveAttribute('data-page', '13'))
    expect(api.fetchDocumentFile).toHaveBeenCalledTimes(1)
  })

  it('offers the document in a tab of its own, and as a download', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    await openResult(0)
    await screen.findByTestId('pdf-stub')
    const tab = screen.getByRole('link', { name: /open in a new tab/i })
    expect(tab).toHaveAttribute('href', `#/view/a?chunk=4&q=${encodeURIComponent('更换滤芯')}`)
    expect(tab).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: /download/i })).toHaveAttribute(
      'href',
      '/api/documents/a/file',
    )
  })

  it('falls back to the passage text, highlighted, when the file cannot be shown', async () => {
    vi.mocked(api.fetchDocumentFile).mockResolvedValue({
      data: new ArrayBuffer(8),
      kind: 'other',
      filename: null,
    })
    const titleOnly = { ...response.results[0], text: '第一章 安全注意事项' }
    vi.spyOn(api, 'search').mockResolvedValue({ ...response, query: '安全', results: [titleOnly] })
    renderApp()
    await searchFor('安全')
    await openResult(0)
    expect(await screen.findByText("Can't preview this file")).toBeInTheDocument()
    const text = (await screen.findByRole('dialog')).querySelector('.detail-text')
    expect(text).toHaveTextContent('第一章 安全注意事项')
    expect(text?.querySelector('mark')).toHaveTextContent('安全')
  })

  it('says so when the file is gone, and still offers the passage', async () => {
    vi.mocked(api.fetchDocumentFile).mockRejectedValue(new Error('No such document'))
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    await openResult(1)
    expect(await screen.findByText('No such document')).toBeInTheDocument()
    expect(await screen.findByRole('dialog')).toHaveTextContent('필터를 교체하기 전에')
  })

  it('keeps the developer fields out of sight unless asked for', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    await openResult(0)
    const panel = await screen.findByRole('dialog')
    expect(within(panel).queryByText('Passage number')).not.toBeInTheDocument()
    expect(within(panel).queryByText('/documents/manual_zh.pdf')).not.toBeInTheDocument()
  })

  it('shows the developer fields in developer mode', async () => {
    givenSettings({ developerMode: true })
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    await openResult(1)
    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByText('Passage number')).toBeInTheDocument()
    expect(within(panel).getByText('#1')).toBeInTheDocument()
    expect(within(panel).getByText('/documents/manual_ko.pdf')).toBeInTheDocument()
  })

  it('moves between results with the arrow keys, and the open panel follows', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
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

  it('hides the admin link unless the setting asks for it', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    await openResult(0)
    await screen.findByRole('dialog')
    expect(screen.queryByRole('link', { name: /inspect passages/i })).not.toBeInTheDocument()
  })

  it('shows the admin link when the setting is on', async () => {
    givenSettings({ showAdminLinks: true })
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
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
    renderApp()
    await searchFor('更换滤芯')
    const card = (await screen.findAllByTestId('result-card'))[0]
    expect(card).toHaveStyle({ maxHeight: `${CARD_MAX_HEIGHT[3]}px` })
  })

  it('grows when the preview-lines setting does', async () => {
    givenSettings({ previewLines: 6 })
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    const card = (await screen.findAllByTestId('result-card'))[0]
    expect(card).toHaveStyle({ maxHeight: `${CARD_MAX_HEIGHT[6]}px` })
  })

  it('puts the passage first and keeps the score to a quiet label', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    const [strong] = await screen.findAllByTestId('result-card')
    expect(strong).toHaveClass('relevance-strong')
    expect(within(strong).getByText('Strong match')).toBeInTheDocument()
    expect(within(strong).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(within(strong).queryByText('0.91')).not.toBeInTheDocument()
  })

  it('highlights the parts of a CJK query that appear in the passage', async () => {
    vi.spyOn(api, 'search').mockResolvedValue({ ...response, query: '如何更换滤芯' })
    renderApp()
    await searchFor('如何更换滤芯')
    const [card] = await screen.findAllByTestId('result-card')
    const marks = [...card.querySelectorAll('.result-text mark')].map((mark) => mark.textContent)
    // 如何更换滤芯 never appears whole; its pieces do, side by side.
    expect(marks).toEqual(expect.arrayContaining(['更换', '滤芯']))
    expect(marks).not.toContain('如何')
  })

  it('keeps language and owner tags for developer mode', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    const [card] = await screen.findAllByTestId('result-card')
    expect(within(card).queryByText('zh')).not.toBeInTheDocument()
  })

  it('no longer offers an inline Show more', async () => {
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    await screen.findAllByTestId('result-card')
    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument()
  })
})

describe('a results link opened fresh', () => {
  it('waits for a check that never answers only once', async () => {
    vi.spyOn(api, 'fetchReadiness').mockReturnValue(new Promise(() => undefined))
    const searchSpy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    await waitFor(() => expect(searchSpy).toHaveBeenCalledTimes(1), { timeout: 2500 })
    const started = Date.now()
    await searchFor('滤芯')
    await waitFor(() => expect(searchSpy).toHaveBeenCalledTimes(2))
    expect(Date.now() - started).toBeLessThan(900)
  })

  it('waits for the first readiness check, so its search gets an answer', async () => {
    let answer: (value: api.Readiness) => void = () => undefined
    vi.spyOn(api, 'fetchReadiness').mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const askSpy = mockAsk((handlers) => handlers.onResults(response))
    renderResults('更换滤芯')
    window.setTimeout(
      () => answer({ status: 'ready', model_loaded: true, answers_available: true }),
      100,
    )
    await waitFor(() => expect(askSpy).toHaveBeenCalledOnce())
  })
})

describe('who is searching', () => {
  it('offers an administrator the owner and visibility filters', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue([])
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderResults('更换滤芯')
    expect(await screen.findByLabelText('Owner')).toBeInTheDocument()
    expect(screen.getByLabelText('Visibility')).toBeInTheDocument()
    expect(screen.queryByLabelText('Show')).not.toBeInTheDocument()
  })

  it('offers a user the choice between their own documents and public ones', async () => {
    asUser()
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderResults('更换滤芯')
    await screen.findByRole('button', { name: 'Account: kim' })
    expect(screen.getByLabelText('Show')).toBeInTheDocument()
    expect(screen.queryByLabelText('Owner')).not.toBeInTheDocument()
  })

  it('shows a logged-out visitor no scope filter: they only ever see public documents', async () => {
    loggedOut()
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderResults('更换滤芯')
    await waitFor(() => expect(screen.getAllByTestId('result-card')).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Show')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Owner')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Visibility')).not.toBeInTheDocument()
    // The results-page tools a visitor does get.
    expect(screen.getByLabelText('Results to show')).toBeInTheDocument()
    expect(screen.getByLabelText('Language')).toBeInTheDocument()
  })

  it('runs the search again when the visitor logs in, for their own documents too', async () => {
    loggedOut()
    vi.spyOn(api, 'login').mockResolvedValue({ user: USER })
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderResults('更换滤芯')
    await waitFor(() => expect(screen.getAllByTestId('result-card')).toHaveLength(2))
    expect(spy).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
    const dialog = await findDialog('Log in to DocSage')
    await userEvent.type(within(dialog).getByLabelText('Username'), 'kim')
    await userEvent.type(within(dialog).getByLabelText('Password'), 'a long password')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('button', { name: 'Account: kim' })).toBeInTheDocument()
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    expect(spy).toHaveBeenLastCalledWith({ query: '更换滤芯', topK: 10 })
    // Still on the same results, now with the scope filter a user has.
    expect(currentLocation()).toBe(`/search?q=${encodeURIComponent('更换滤芯')}`)
    expect(screen.getByRole('combobox', { name: 'Show' })).toBeInTheDocument()
  })

  it('stays on the results after logging out, and searches again as a visitor', async () => {
    asUser()
    vi.spyOn(api, 'logout').mockResolvedValue(undefined)
    const spy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderResults('更换滤芯')
    await userEvent.click(await screen.findByRole('button', { name: 'Account: kim' }))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    await userEvent.click(await screen.findByText('Log out'))

    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument()
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    expect(currentLocation()).toBe(`/search?q=${encodeURIComponent('更换滤芯')}`)
    expect(screen.getAllByTestId('result-card')).toHaveLength(2)
    expect(screen.queryByLabelText('Show')).not.toBeInTheDocument()
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
    const { container } = renderApp()
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
    renderApp()
    await searchFor('更换滤芯')
    await screen.findByTestId('answer-text')
    // The header's search button, which spins while a search runs.
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
    renderApp()
    await searchFor('更换滤芯')
    await waitFor(() => expect(signals).toHaveLength(1))
    await searchFor('更换滤芯 again')
    await waitFor(() => expect(signals).toHaveLength(2))
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
  })

  it('searches plainly when the backend has no answer model', async () => {
    const askSpy = answering()
    const searchSpy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
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
    renderApp()
    await searchFor('更换滤芯')
    await waitFor(() => expect(searchSpy).toHaveBeenCalledOnce())
    expect(askSpy).not.toHaveBeenCalled()
  })

  it('searches plainly when the reader turned answers off', async () => {
    givenSettings({ answersEnabled: false })
    const readiness = givenAnswers(true)
    const askSpy = answering()
    const searchSpy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
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
    renderApp()
    await searchFor('更换滤芯')
    await waitFor(() => expect(screen.getAllByTestId('result-card')).toHaveLength(2))
    expect(askSpy).toHaveBeenCalledOnce()
    expect(searchSpy).toHaveBeenCalledWith({ query: '更换滤芯', topK: 10 })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Answer' })).not.toBeInTheDocument()
  })

  it('falls back with the same filters the reader chose', async () => {
    givenAnswers(true)
    vi.spyOn(api, 'ask').mockRejectedValue(new Error('Not Found'))
    const searchSpy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderResults('更换滤芯')
    await screen.findAllByTestId('result-card')
    await chooseOption('Language', 'Korean')
    await searchFor('更换滤芯')

    await waitFor(() =>
      expect(searchSpy).toHaveBeenLastCalledWith({ query: '更换滤芯', topK: 10, language: 'ko' }),
    )
    expect(screen.getAllByTestId('result-card')).toHaveLength(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Answer' })).not.toBeInTheDocument()
  })

  it('asks the backend again, at most every 30 seconds, while answers are unavailable', async () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const readiness = givenAnswers(false)
    vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
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

  it('waits no more than a moment for a readiness check that never answers', async () => {
    vi.spyOn(api, 'fetchReadiness').mockReturnValue(new Promise(() => undefined))
    const askSpy = answering()
    const searchSpy = vi.spyOn(api, 'search').mockResolvedValue(response)
    renderApp()
    await searchFor('更换滤芯')
    await waitFor(() => expect(screen.getAllByTestId('result-card')).toHaveLength(2), {
      timeout: 2500,
    })
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
    renderApp()
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
    renderApp()
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
    renderApp()
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
