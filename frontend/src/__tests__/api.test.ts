// frontend/src/__tests__/api.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDocuments, getIndexStatus, search, startIndexing } from '../services/api'

function mockFetch(body: unknown, ok = true, status = 200) {
  const spy = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('search', () => {
  it('posts the query and the top_k to /api/search', async () => {
    const spy = mockFetch({ query: 'x', count: 0, took_ms: 3, results: [] })
    await search({ query: '滤芯', topK: 5 })

    expect(spy).toHaveBeenCalledOnce()
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('/api/search')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ query: '滤芯', top_k: 5 })
  })

  it('includes filters only when one is set', async () => {
    const spy = mockFetch({ query: 'x', count: 0, took_ms: 1, results: [] })
    await search({ query: '滤芯', topK: 5, language: 'ko' })
    expect(JSON.parse(spy.mock.calls[0][1].body).filters).toEqual({ language: 'ko' })

    await search({ query: '滤芯', topK: 5 })
    expect(JSON.parse(spy.mock.calls[1][1].body).filters).toBeUndefined()
  })

  it('returns the parsed response', async () => {
    mockFetch({
      query: '滤芯',
      count: 1,
      took_ms: 42,
      results: [
        {
          score: 0.91,
          document_id: 'abc',
          filename: 'manual.pdf',
          filepath: '/documents/manual.pdf',
          page_start: 12,
          page_end: 12,
          chunk_index: 4,
          text: '更换滤芯',
        },
      ],
    })
    const response = await search({ query: '滤芯', topK: 10 })
    expect(response.count).toBe(1)
    expect(response.took_ms).toBe(42)
    expect(response.results[0].filename).toBe('manual.pdf')
  })

  it('throws the backend detail message on a 400', async () => {
    mockFetch({ detail: 'cannot search for an empty query' }, false, 400)
    await expect(search({ query: '  ', topK: 10 })).rejects.toThrow(
      'cannot search for an empty query',
    )
  })

  it('throws a readable message when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(search({ query: 'x', topK: 10 })).rejects.toThrow(/backend/i)
  })
})

describe('indexing', () => {
  it('posts an empty body when no directory is given', async () => {
    const spy = mockFetch({ status: 'started', directory: '/documents' })
    await startIndexing()
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ force: false })
  })

  it('reports already_running without throwing', async () => {
    mockFetch({ status: 'already_running', directory: '/documents' }, false, 409)
    await expect(startIndexing()).resolves.toEqual({
      status: 'already_running',
      directory: '/documents',
    })
  })

  it('reads the status', async () => {
    mockFetch({ status: 'completed', total_documents: 10, indexed_documents: 10 })
    const status = await getIndexStatus()
    expect(status.status).toBe('completed')
    expect(status.total_documents).toBe(10)
  })
})

describe('documents', () => {
  it('reads the document list', async () => {
    mockFetch([{ document_id: 'a', filename: 'm.pdf', pages: 3, chunks: 9, status: 'indexed' }])
    const documents = await getDocuments()
    expect(documents).toHaveLength(1)
    expect(documents[0].filename).toBe('m.pdf')
  })
})
