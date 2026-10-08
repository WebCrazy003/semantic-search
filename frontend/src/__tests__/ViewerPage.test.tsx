// frontend/src/__tests__/ViewerPage.test.tsx
// A document in a tab of its own (spec 2026-10-08 §2.1, acceptance V2.5).
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../services/api'
import { loggedOut, renderApp } from './helpers'

vi.mock('../viewer/PdfView', () => ({
  default: (props: { target: { pageStart: number; text: string } | null }) => (
    <div
      data-testid="pdf-stub"
      data-page={props.target?.pageStart ?? 'top'}
      data-passage={props.target?.text ?? ''}
    />
  ),
}))

const passage: api.Passage = {
  document_id: 'a',
  chunk_index: 4,
  filename: 'manual_zh.pdf',
  file_type: 'pdf',
  page_start: 12,
  page_end: 12,
  heading: '第一章',
  text: '第一章 在更换滤芯之前，必须先关闭主电源开关。',
}

beforeEach(() => {
  vi.spyOn(api, 'fetchDocumentFile').mockResolvedValue({
    data: new ArrayBuffer(8),
    kind: 'pdf',
    filename: 'manual_zh.pdf',
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the full-tab viewer', () => {
  it('fetches the passage a link names and highlights it, without its repeated heading', async () => {
    const getPassage = vi.spyOn(api, 'getPassage').mockResolvedValue(passage)
    renderApp('/view/a?chunk=4&q=滤芯')
    const stub = await screen.findByTestId('pdf-stub')
    expect(getPassage).toHaveBeenCalledWith('a', 4)
    expect(stub).toHaveAttribute('data-page', '12')
    expect(stub).toHaveAttribute('data-passage', '在更换滤芯之前，必须先关闭主电源开关。')
    // A tab of its own needs no "open in a new tab".
    expect(screen.queryByRole('link', { name: /open in a new tab/i })).not.toBeInTheDocument()
  })

  it('opens at the top with nothing marked when no passage is named', async () => {
    const getPassage = vi.spyOn(api, 'getPassage')
    renderApp('/view/a')
    expect(await screen.findByTestId('pdf-stub')).toHaveAttribute('data-page', 'top')
    expect(getPassage).not.toHaveBeenCalled()
  })

  it('works for a visitor reading a public document', async () => {
    loggedOut()
    vi.spyOn(api, 'getPassage').mockResolvedValue(passage)
    renderApp('/view/a?chunk=4')
    expect(await screen.findByTestId('pdf-stub')).toBeInTheDocument()
  })

  it('says the document is not available when it cannot be read', async () => {
    loggedOut()
    vi.spyOn(api, 'getPassage').mockRejectedValue(new Error('No such document'))
    renderApp('/view/secret?chunk=0')
    expect(await screen.findByText('This document is not available')).toBeInTheDocument()
    expect(screen.getByText(/log in to see your own documents/i)).toBeInTheDocument()
  })
})
