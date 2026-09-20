// frontend/src/__tests__/SearchResult.test.tsx
import { render, screen } from '@testing-library/react'
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
