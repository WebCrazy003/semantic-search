// frontend/src/__tests__/AnswerPanel.test.tsx
// The answer panel, driven through the search page as a reader meets it: /api/ask is
// replaced by a script that calls the stream's handlers.

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchPage } from '../pages/SearchPage'
import * as api from '../services/api'
import { makeStatus } from './fixtures'
import { givenAnswers, givenSettings, mockAsk, renderWithProviders, untilAborted } from './helpers'

const response: api.SearchResponse = {
  query: 'How often are the seals replaced?',
  count: 3,
  took_ms: 84,
  results: [
    {
      score: 0.82,
      document_id: 'a',
      filename: 'manual_ko.pdf',
      filepath: '/documents/manual_ko.pdf',
      page_start: 12,
      page_end: 12,
      chunk_index: 4,
      heading: '정비 주기',
      language: 'ko',
      text: '씰은 2,000 운전 시간마다 교체합니다.',
      file_type: 'pdf',
    },
    {
      score: 0.79,
      document_id: 'b',
      filename: 'service.docx',
      filepath: '/documents/service.docx',
      page_start: 3,
      page_end: 3,
      chunk_index: 9,
      heading: 'Gland bolts',
      language: 'en',
      text: 'Tighten the gland bolts to 25 N·m.',
      file_type: 'docx',
    },
    {
      score: 0.6,
      document_id: 'c',
      filename: 'other.pdf',
      filepath: '/documents/other.pdf',
      page_start: 1,
      page_end: 1,
      chunk_index: 0,
      heading: 'Unrelated',
      language: 'en',
      text: 'Something else entirely.',
    },
  ],
}

const sources = (language: api.AnswerLanguage = 'en', unsupported = false): api.AskSources => ({
  language,
  unsupported,
  passages: [
    { n: 1, document_id: 'a', chunk_index: 4 },
    { n: 2, document_id: 'b', chunk_index: 9 },
  ],
})

const done = (status: api.AskDone['status'] = 'answered'): api.AskDone => ({
  status,
  answer_ms: 3120,
  model: 'qwen3-4b',
  restarted: false,
})

/** A complete answer: results, sources, the text in pieces, then done. */
function answers(text: string | string[], options: { language?: api.AnswerLanguage; unsupported?: boolean; status?: api.AskDone['status'] } = {}) {
  return mockAsk((handlers) => {
    handlers.onResults(response)
    handlers.onSources(sources(options.language, options.unsupported))
    for (const piece of Array.isArray(text) ? text : [text]) handlers.onDelta(piece)
    handlers.onDone(done(options.status))
  })
}

beforeEach(() => {
  vi.spyOn(api, 'getDocuments').mockResolvedValue([])
  vi.spyOn(api, 'getIndexStatus').mockResolvedValue(makeStatus())
  vi.spyOn(api, 'getJobs').mockResolvedValue([])
  givenAnswers(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function ask(question = 'How often are the seals replaced?') {
  await userEvent.type(screen.getByRole('textbox', { name: /search documents/i }), `${question}{Enter}`)
}

const panel = () => screen.findByRole('region', { name: 'Answer' })
const answerText = async () => within(await panel()).findByTestId('answer-text')

describe('while the answer is being written', () => {
  it('shows a skeleton until the first words, then the words, with Stop', async () => {
    let write: (text: string) => void = () => undefined
    mockAsk(async (handlers, signal) => {
      handlers.onResults(response)
      handlers.onSources(sources())
      write = handlers.onDelta
      await untilAborted(signal)
    })
    const { container } = renderWithProviders(<SearchPage />)
    await ask()

    const region = await panel()
    expect(region.querySelector('.ant-skeleton')).toBeTruthy()
    expect(region.querySelector('[aria-live="polite"]')).toHaveAttribute('aria-busy', 'true')
    expect(within(region).getByRole('button', { name: /stop/i })).toBeInTheDocument()
    // The results are already there, below the panel.
    expect(screen.getAllByTestId('result-card')).toHaveLength(3)
    const order = region.compareDocumentPosition(container.querySelector('.result-list')!)
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    write('The seals are replaced ')
    write('every 2,000 hours')
    expect(await answerText()).toHaveTextContent('The seals are replaced every 2,000 hours')
    expect(region.querySelector('.ant-skeleton')).toBeNull()
  })

  it('stops when Stop is pressed and keeps what was written', async () => {
    let aborted = false
    mockAsk(async (handlers, signal) => {
      handlers.onResults(response)
      handlers.onDelta('The seals are')
      await untilAborted(signal)
      aborted = true
    })
    renderWithProviders(<SearchPage />)
    await ask()
    await answerText()
    await userEvent.click(within(await panel()).getByRole('button', { name: /stop/i }))

    await waitFor(() => expect(aborted).toBe(true))
    const region = await panel()
    expect(within(region).getByText('Stopped.')).toBeInTheDocument()
    expect(within(region).getByTestId('answer-text')).toHaveTextContent('The seals are')
    expect(within(region).queryByRole('button', { name: /stop/i })).not.toBeInTheDocument()
    expect(region.querySelector('[aria-live="polite"]')).toHaveAttribute('aria-busy', 'false')
  })
})

describe('citations', () => {
  it('turns [n] into chips and lists the sources with their pages', async () => {
    answers('Replace the seals every 2,000 hours [1]. Tighten to 25 N·m [2].')
    renderWithProviders(<SearchPage />)
    await ask()

    const region = await panel()
    const text = await answerText()
    expect(within(text).getByRole('button', { name: 'Source 1: manual_ko.pdf, Page 12' })).toHaveTextContent('1')
    expect(within(text).getByRole('button', { name: 'Source 2: service.docx, Page ~3' })).toHaveTextContent('2')
    expect(text).not.toHaveTextContent('[1]')

    const list = region.querySelector('.answer-sources') as HTMLElement
    expect(list).toHaveTextContent('Sources:')
    expect(list).toHaveTextContent('manual_ko.pdf · Page 12')
    expect(list).toHaveTextContent('service.docx · Page ~3')
    expect(list).not.toHaveTextContent('other.pdf')
  })

  it('reads [1][2] and [1, 2] as two citations each', async () => {
    answers('Both say so [1][2], twice [1, 2].')
    renderWithProviders(<SearchPage />)
    await ask()
    const text = await answerText()
    expect(within(text).getAllByRole('button', { name: /^source 1/i })).toHaveLength(2)
    expect(within(text).getAllByRole('button', { name: /^source 2/i })).toHaveLength(2)
    expect(text).toHaveTextContent('Both say so 12, twice 12.')
  })

  it('opens the cited result when a chip is clicked', async () => {
    answers('Tighten to 25 N·m [2].')
    renderWithProviders(<SearchPage />)
    await ask()
    const text = await answerText()
    await userEvent.click(within(text).getByRole('button', { name: /^source 2/i }))

    const cards = screen.getAllByTestId('result-card')
    await waitFor(() => expect(cards[1]).toHaveAttribute('aria-selected', 'true'))
    expect(cards[0]).toHaveAttribute('aria-selected', 'false')
    expect(cards[1]).toHaveFocus()
    expect(await screen.findByRole('dialog')).toHaveTextContent('Tighten the gland bolts')
  })

  it('leaves a number with no matching source as plain text', async () => {
    answers('Known [1], unknown [9].')
    renderWithProviders(<SearchPage />)
    await ask()
    const text = await answerText()
    expect(text).toHaveTextContent('Known 1, unknown [9].')
    expect(within(text).queryByRole('button', { name: /source 9/i })).not.toBeInTheDocument()
  })

  it('marks the cited results in the list with their number', async () => {
    answers('Tighten to 25 N·m [2].')
    renderWithProviders(<SearchPage />)
    await ask()
    await answerText()
    const cards = screen.getAllByTestId('result-card')
    expect(within(cards[1]).getByText('[2]')).toBeInTheDocument()
    // Given to the model but not cited: no badge.
    expect(within(cards[0]).queryByText('[1]')).not.toBeInTheDocument()
    expect(within(cards[2]).queryByText(/\[\d\]/)).not.toBeInTheDocument()
  })
})

describe('the text', () => {
  it('shows HTML from the model as text, never as markup', async () => {
    answers('<img src=x onerror=alert(1)> and <b>bold</b>')
    const { container } = renderWithProviders(<SearchPage />)
    await ask()
    const text = await answerText()
    expect(text).toHaveTextContent('<img src=x onerror=alert(1)> and <b>bold</b>')
    expect(container.querySelector('.answer-panel img')).toBeNull()
    expect(container.querySelector('.answer-panel b')).toBeNull()
  })

  it('drops Markdown bold markers and keeps paragraph breaks', async () => {
    answers(['The **seals** are replaced ', 'every **2,000 hours** [1].\n\nCheck them weekly.'])
    renderWithProviders(<SearchPage />)
    await ask()
    const text = await answerText()
    expect(text.textContent).toBe('The seals are replaced every 2,000 hours 1.\n\nCheck them weekly.')
  })

  it('copies the plain answer once it is done', async () => {
    answers('The **seals** last 2,000 hours [1].')
    renderWithProviders(<SearchPage />)
    await ask()
    await answerText()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    fireEvent.click(within(await panel()).getByRole('button', { name: /copy the answer/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('The seals last 2,000 hours [1].'))
    expect(await within(await panel()).findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })
})

describe('outcomes', () => {
  it('styles "not found" as a quiet message, without sources or footer', async () => {
    answers('Not found in your documents.', { status: 'not_found' })
    renderWithProviders(<SearchPage />)
    await ask()
    const text = await answerText()
    expect(text).toHaveClass('answer-not-found')
    const region = await panel()
    expect(region.querySelector('.answer-sources')).toBeNull()
    expect(within(region).queryByText(/generated from your documents/i)).not.toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: /copy/i })).not.toBeInTheDocument()
  })

  it('shows a failure inside the panel and keeps the results', async () => {
    mockAsk((handlers) => {
      handlers.onResults(response)
      handlers.onError({ code: 'unavailable', message: 'The answer model is not responding.' })
    })
    renderWithProviders(<SearchPage />)
    await ask()
    const region = await panel()
    expect(await within(region).findByText(/the answer model is not responding/i)).toBeInTheDocument()
    expect(screen.getAllByTestId('result-card')).toHaveLength(3)
    // Not the page-level error: that one means the search itself failed.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('language', () => {
  it.each([
    ['en', 'Generated from your documents. Check the sources.'],
    ['zh-Hans', '根据您的文档生成，请核对来源。'],
    ['zh-Hant', '根據您的文件生成，請核對來源。'],
    ['ko', '문서를 바탕으로 생성된 답변입니다. 출처를 확인하세요.'],
  ] as const)('writes the footer in %s', async (language, footer) => {
    answers('… [1]', { language })
    renderWithProviders(<SearchPage />)
    await ask()
    await answerText()
    expect(within(await panel()).getByText(footer)).toBeInTheDocument()
  })

  it('says which languages it answers in when the question was in another one', async () => {
    answers('The seals are replaced every 2,000 hours [1].', { unsupported: true })
    renderWithProviders(<SearchPage />)
    await ask('シールの交換頻度は？')
    expect(
      await within(await panel()).findByText('Answers are given in English, Chinese or Korean.'),
    ).toBeInTheDocument()
  })

  it('does not show the notice for a supported language', async () => {
    answers('씰은 2,000시간마다 교체합니다 [1].', { language: 'ko' })
    renderWithProviders(<SearchPage />)
    await ask('씰 교체 주기는?')
    await answerText()
    expect(screen.queryByText(/answers are given in english/i)).not.toBeInTheDocument()
  })
})

describe('developer mode', () => {
  it('shows the model and how long the answer took', async () => {
    givenSettings({ developerMode: true })
    answers('… [1]')
    renderWithProviders(<SearchPage />)
    await ask()
    await answerText()
    expect(within(await panel()).getByText(/qwen3-4b · 3120 ms/)).toBeInTheDocument()
  })
})
