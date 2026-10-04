// frontend/src/__tests__/api.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ask,
  fetchReadiness,
  getDocuments,
  getIndexStatus,
  search,
  startIndexing,
  type AskHandlers,
  type SearchParams,
  type SearchResponse,
} from '../services/api'

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

describe('readiness', () => {
  it('shares one request between callers asking at the same time', async () => {
    const spy = mockFetch({ status: 'ready', model_loaded: true, answers_available: true })
    const [first, second] = await Promise.all([fetchReadiness(), fetchReadiness()])
    expect(spy).toHaveBeenCalledOnce()
    expect(first).toEqual(second)
    expect(first.answers_available).toBe(true)

    // Once it has settled, the next call asks again.
    await fetchReadiness()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('lets every waiting caller see a failure, and then asks afresh', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const results = await Promise.allSettled([fetchReadiness(), fetchReadiness()])
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    const spy = mockFetch({ status: 'ready', model_loaded: true })
    await expect(fetchReadiness()).resolves.toMatchObject({ status: 'ready' })
    expect(spy).toHaveBeenCalledOnce()
  })
})

describe('indexing', () => {
  it('posts an empty body when no directory is given', async () => {
    const spy = mockFetch({ status: 'started', directory: '/documents' })
    await startIndexing()
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ force: false, trigger: 'scan' })
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

// ------------------------------------------------------------------ ask (SSE)

const RESULTS: SearchResponse = {
  query: '滤芯多久更换',
  count: 1,
  took_ms: 90,
  results: [
    {
      score: 0.9,
      document_id: 'a',
      filename: 'manual_zh.pdf',
      filepath: '/documents/manual_zh.pdf',
      page_start: 12,
      page_end: 12,
      chunk_index: 4,
      text: '每2000小时更换滤芯。',
    },
  ],
}

const SOURCES = {
  language: 'zh-Hans',
  unsupported: false,
  passages: [{ n: 1, document_id: 'a', chunk_index: 4 }],
}

const DONE = { status: 'answered', answer_ms: 1200, model: 'qwen3-4b', restarted: false }

function event(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
}

const STREAM =
  event('results', RESULTS) +
  event('sources', SOURCES) +
  event('delta', { text: '滤芯每2000小时' }) +
  event('delta', { text: '更换一次[1]。' }) +
  event('done', DONE)

/** A fetch whose body arrives as these byte chunks, then (optionally) stays open. */
function mockStream(chunks: (string | Uint8Array)[], { keepOpen = false } = {}) {
  const encoder = new TextEncoder()
  const spy = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
        }
        init.signal?.addEventListener('abort', () =>
          controller.error(new DOMException('The operation was aborted.', 'AbortError')),
        )
        if (!keepOpen) controller.close()
      },
    })
    return { ok: true, status: 200, body, json: async () => null }
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

/** Splits bytes at a fixed stride, so chunks break mid-line and mid-character. */
function bytesEvery(text: string, stride: number): Uint8Array[] {
  const bytes = new TextEncoder().encode(text)
  const chunks: Uint8Array[] = []
  for (let start = 0; start < bytes.length; start += stride) {
    chunks.push(bytes.slice(start, start + stride))
  }
  return chunks
}

function recorder() {
  const calls: [string, unknown][] = []
  const handlers: AskHandlers = {
    onResults: (value) => calls.push(['results', value]),
    onSources: (value) => calls.push(['sources', value]),
    onDelta: (value) => calls.push(['delta', value]),
    onDone: (value) => calls.push(['done', value]),
    onError: (value) => calls.push(['error', value]),
  }
  return { calls, handlers, names: () => calls.map(([name]) => name) }
}

const PARAMS: SearchParams = { query: '滤芯多久更换', topK: 10 }

describe('ask', () => {
  it('reads every event in order when they all arrive in one chunk', async () => {
    mockStream([STREAM])
    const { calls, handlers, names } = recorder()
    await ask(PARAMS, handlers)
    expect(names()).toEqual(['results', 'sources', 'delta', 'delta', 'done'])
    expect(calls[0][1]).toEqual(RESULTS)
    expect(calls[1][1]).toEqual(SOURCES)
    expect(calls[2][1]).toBe('滤芯每2000小时')
    expect(calls[3][1]).toBe('更换一次[1]。')
    expect(calls[4][1]).toEqual(DONE)
  })

  it('copes with events split anywhere, even inside a character', async () => {
    for (const stride of [1, 3, 7, 50]) {
      mockStream(bytesEvery(STREAM, stride))
      const { calls, handlers, names } = recorder()
      await ask(PARAMS, handlers)
      expect(names()).toEqual(['results', 'sources', 'delta', 'delta', 'done'])
      expect(calls[2][1]).toBe('滤芯每2000小时')
    }
  })

  it('accepts CRLF line endings, including a CR and LF in different chunks', async () => {
    const crlf = STREAM.replace(/\n/g, '\r\n')
    mockStream(bytesEvery(crlf, 5))
    const { calls, handlers, names } = recorder()
    await ask(PARAMS, handlers)
    expect(names()).toEqual(['results', 'sources', 'delta', 'delta', 'done'])
    expect(calls[3][1]).toBe('更换一次[1]。')
  })

  it('ignores comments and keep-alive lines', async () => {
    mockStream([': ping\n\n' + event('results', RESULTS) + ':\n\n' + event('done', DONE)])
    const { handlers, names } = recorder()
    await ask(PARAMS, handlers)
    expect(names()).toEqual(['results', 'done'])
  })

  it('reports an error event after the results and keeps them', async () => {
    mockStream([
      event('results', RESULTS) +
        event('error', { code: 'unavailable', message: 'The answer model is not responding.' }),
    ])
    const { calls, handlers, names } = recorder()
    await ask(PARAMS, handlers)
    expect(names()).toEqual(['results', 'error'])
    expect(calls[1][1]).toEqual({
      code: 'unavailable',
      message: 'The answer model is not responding.',
    })
  })

  it('treats a stream that ends without done as an error', async () => {
    mockStream([event('results', RESULTS) + event('delta', { text: 'half' })])
    const { calls, handlers, names } = recorder()
    await ask(PARAMS, handlers)
    expect(names()).toEqual(['results', 'delta', 'error'])
    expect(calls[2][1]).toEqual({ code: 'failed', message: 'The answer stopped unexpectedly.' })
  })

  it('rejects when the stream fails before any results, so the caller can fall back', async () => {
    mockStream([event('error', { code: 'failed', message: 'Search is not ready.' })])
    const { handlers, names } = recorder()
    await expect(ask(PARAMS, handlers)).rejects.toThrow('Search is not ready.')
    expect(names()).toEqual([])
  })

  it('throws the backend detail on a response that is not ok', async () => {
    mockFetch({ detail: 'The answer model is not available.' }, false, 503)
    const { handlers, names } = recorder()
    await expect(ask(PARAMS, handlers)).rejects.toThrow('The answer model is not available.')
    expect(names()).toEqual([])
  })

  it('throws a readable message when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(ask(PARAMS, recorder().handlers)).rejects.toThrow(/backend/i)
  })

  it('resolves quietly when aborted mid-stream', async () => {
    mockStream([event('results', RESULTS) + event('delta', { text: 'The seals ' })], {
      keepOpen: true,
    })
    const controller = new AbortController()
    const { handlers, names } = recorder()
    const pending = ask(PARAMS, handlers, controller.signal)
    await vi.waitFor(() => expect(names()).toEqual(['results', 'delta']))
    controller.abort()
    await expect(pending).resolves.toBeUndefined()
    expect(names()).toEqual(['results', 'delta'])
  })

  it('resolves quietly when aborted before the response arrives', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted.', 'AbortError')),
            )
          }),
      ),
    )
    const controller = new AbortController()
    const { handlers, names } = recorder()
    const pending = ask(PARAMS, handlers, controller.signal)
    controller.abort()
    await expect(pending).resolves.toBeUndefined()
    expect(names()).toEqual([])
  })

  it('sends exactly the body search() sends, with the same headers', async () => {
    const params: SearchParams = {
      query: '필터 교체',
      topK: 20,
      language: 'ko',
      scope: 'mine',
      ownerId: 'library',
      visibility: 'public',
    }
    const searchSpy = mockFetch(RESULTS)
    await search(params)
    const searchInit = searchSpy.mock.calls[0][1]

    const askSpy = mockStream([STREAM])
    await ask(params, recorder().handlers)
    const [url, askInit] = askSpy.mock.calls[0]

    expect(url).toBe('/api/ask')
    expect(askInit.method).toBe('POST')
    expect(askInit.body).toBe(searchInit.body)
    expect(JSON.parse(askInit.body)).toEqual({
      query: '필터 교체',
      top_k: 20,
      scope: 'mine',
      filters: { language: 'ko', owner_id: 'library', visibility: 'public' },
    })
    expect(askInit.credentials).toBe('same-origin')
    expect(new Headers(askInit.headers).get('X-DocSage')).toBe('1')
    expect(new Headers(askInit.headers).get('content-type')).toBe('application/json')
  })
})
