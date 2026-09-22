// frontend/src/__tests__/SearchResult.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SearchResult } from '../components/SearchResult'
import type { SearchHit } from '../services/api'

const hit: SearchHit = {
  score: 0.9123,
  document_id: 'abc123',
  filename: 'manual_zh.pdf',
  filepath: '/documents/manual_zh.pdf',
  page_start: 12,
  page_end: 12,
  chunk_index: 4,
  heading: '第一章 安全注意事项',
  language: 'zh',
  text: '在更换滤芯之前，必须先关闭主电源开关。',
}

describe('SearchResult', () => {
  it('shows the filename, page, score, and passage', () => {
    render(<SearchResult hit={hit} />)
    expect(screen.getByText('manual_zh.pdf')).toBeInTheDocument()
    expect(screen.getByText('Page 12')).toBeInTheDocument()
    expect(screen.getByText('0.912')).toBeInTheDocument()
    expect(screen.getByText(/在更换滤芯之前/)).toBeInTheDocument()
  })

  it('shows the heading when there is one', () => {
    render(<SearchResult hit={hit} />)
    expect(screen.getByText('第一章 安全注意事项')).toBeInTheDocument()
  })

  it('shows a page range when a chunk spans pages', () => {
    render(<SearchResult hit={{ ...hit, page_start: 7, page_end: 8 }} />)
    expect(screen.getByText('Pages 7 to 8')).toBeInTheDocument()
  })

  it('omits the heading line when there is no heading', () => {
    render(<SearchResult hit={{ ...hit, heading: null }} />)
    expect(screen.queryByText('第一章 安全注意事项')).not.toBeInTheDocument()
  })
})

describe('long passages', () => {
  const long = '第一句。'.repeat(200) // 800 characters, well past the snippet limit

  function hitWith(text: string): SearchHit {
    return {
      score: 0.61,
      document_id: 'a',
      filename: 'manual_zh.pdf',
      filepath: '/documents/manual_zh.pdf',
      page_start: 3,
      page_end: 3,
      chunk_index: 1,
      heading: null,
      language: 'zh',
      text,
    }
  }

  it('shows a snippet rather than the whole passage', () => {
    render(<SearchResult hit={hitWith(long)} />)
    const shown = screen.getByText(/第一句/).textContent ?? ''
    expect(shown.length).toBeLessThan(long.length)
    expect(shown.endsWith('…')).toBe(true)
  })

  it('offers to show the rest, with its length', () => {
    render(<SearchResult hit={hitWith(long)} />)
    expect(
      screen.getByRole('button', { name: /show more \(\d+ more characters\)/i }),
    ).toBeInTheDocument()
  })

  it('expands to the full passage and collapses again', async () => {
    render(<SearchResult hit={hitWith(long)} />)

    await userEvent.click(screen.getByRole('button', { name: /show more/i }))
    expect(screen.getByText(long)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /show less/i }))
    expect(screen.queryByText(long)).not.toBeInTheDocument()
  })

  it('leaves a short passage alone', () => {
    render(<SearchResult hit={hitWith('短句。')} />)
    expect(screen.getByText('短句。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument()
  })

  it('cuts at a sentence end, not mid-sentence', () => {
    render(<SearchResult hit={hitWith(long)} />)
    const shown = screen.getByText(/第一句/).textContent ?? ''
    expect(shown.replace('…', '').endsWith('。')).toBe(true)
  })

  it('marks words from the query that appear verbatim', () => {
    render(<SearchResult hit={hitWith('版本控制用来跟踪源代码的改动。')} query="版本控制" />)
    expect(screen.getByText('版本控制').tagName).toBe('MARK')
  })
})

describe('readable passages', () => {
  function hitWith(text: string, heading: string | null = null): SearchHit {
    return { ...hit, text, heading }
  }

  it('does not repeat the heading inside the passage', () => {
    render(<SearchResult hit={hitWith('第一章 安全\n必须先关闭主电源。', '第一章 安全')} />)
    expect(screen.getByText(/必须先关闭主电源/).textContent).toBe('必须先关闭主电源。')
  })

  it('keeps a passage that merely starts with similar words', () => {
    render(<SearchResult hit={hitWith('安全第一，必须关闭电源。', '第一章 安全')} />)
    expect(screen.getByText(/安全第一/)).toBeInTheDocument()
  })

  it('does not highlight common English words', () => {
    render(
      <SearchResult
        hit={hitWith('React does not discard what has already been rendered.')}
        query="why does React work"
      />,
    )
    expect(screen.getByText('React').tagName).toBe('MARK')
    expect(screen.queryByText('does')).toBeNull()
  })

  it('still highlights short Chinese terms', () => {
    render(<SearchResult hit={hitWith('重构可以改善代码结构。')} query="重构 代码" />)
    expect(screen.getByText('重构').tagName).toBe('MARK')
  })
})

describe('opening the source PDF', () => {
  it('links to the file at the page the passage came from', () => {
    render(<SearchResult hit={{ ...hit, page_start: 12, page_end: 12 }} />)
    const link = screen.getByRole('link', { name: /open page 12 in the pdf/i })
    expect(link).toHaveAttribute('href', '/api/documents/abc123/file#page=12')
  })

  it('opens in a new tab without handing the opener over', () => {
    render(<SearchResult hit={hit} />)
    const link = screen.getByRole('link', { name: /open page/i })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('uses the first page when a passage spans two', () => {
    render(<SearchResult hit={{ ...hit, page_start: 7, page_end: 8 }} />)
    expect(screen.getByRole('link', { name: /open pages 7 to 8/i })).toHaveAttribute(
      'href',
      '/api/documents/abc123/file#page=7',
    )
  })

  it('shows where the file lives on disk', () => {
    render(<SearchResult hit={hit} />)
    expect(screen.getByText('/documents/manual_zh.pdf')).toBeInTheDocument()
  })

  it('marks the pages of a Word file as approximate', () => {
    render(<SearchResult hit={{ ...hit, file_type: 'docx', page_start: 3, page_end: 3 }} />)
    expect(screen.getByText('Page ~3')).toBeInTheDocument()
  })

  it('offers a Word file as a download, without a page anchor', () => {
    render(<SearchResult hit={{ ...hit, file_type: 'docx', page_start: 3, page_end: 3 }} />)
    const link = screen.getByRole('link', { name: /download the word file/i })
    expect(link).toHaveAttribute('href', '/api/documents/abc123/file')
    expect(link).toHaveAttribute('download')
    expect(screen.queryByRole('link', { name: /in the pdf/i })).not.toBeInTheDocument()
  })
})
