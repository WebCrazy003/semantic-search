// frontend/src/viewer/PdfView.tsx
// A PDF, rendered page by page with pdf.js, scrolled to the hit and with its passage
// highlighted (spec 2026-10-08 §2.2, §2.3). Loaded on demand by DocumentViewer, so the
// home page never downloads pdf.js.
//
// Pages render as they come near the viewport; the hit's pages render at once. The
// highlight is painted as boxes over pdf.js's text layer, measured from the layer's own
// spans, so selecting and copying text keep working underneath.
import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { errorText } from '../services/api'
import { RunText, type Piece } from './textRuns'
import type { ViewProps } from './viewTypes'

GlobalWorkerOptions.workerSrc = workerUrl

// Served from our own origin (vite.config.ts), never a CDN.
const asset = (path: string) => new URL(`pdfjs/${path}/`, document.baseURI).href

const PAGE_GAP = 12
// Pages either side of the one in view that stay drawn; the rest are released.
const KEEP = 3
const SIDE_PADDING = 16
// Pages either side of the hit whose text is searched too: a passage can start on the
// page before the one its first sentence was counted on.
const WINDOW = 1

/** Where to paint, per page: pieces of that page's text items. */
type Marks = Map<number, { passage: Piece[][]; terms: Piece[][] }>

export default function PdfView({ data, target, terms, zoom, onStatus }: ViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [base, setBase] = useState<{ width: number; height: number } | null>(null)
  const [width, setWidth] = useState(0)
  const [marks, setMarks] = useState<Marks>(new Map())
  const [error, setError] = useState<string | null>(null)
  const scrolledFor = useRef<string | null>(null)

  // Load the document. pdf.js takes ownership of the buffer it is given, so it gets a copy.
  useEffect(() => {
    let cancelled = false
    const task = getDocument({
      data: new Uint8Array(data.slice(0)),
      cMapUrl: asset('cmaps'),
      cMapPacked: true,
      standardFontDataUrl: asset('standard_fonts'),
      wasmUrl: asset('wasm'),
      iccUrl: asset('iccs'),
    })
    task.promise
      .then(async (loaded) => {
        const first = await loaded.getPage(1)
        const viewport = first.getViewport({ scale: 1 })
        if (cancelled) return
        setBase({ width: viewport.width, height: viewport.height })
        setPdf(loaded)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorText(caught, 'Cannot read this PDF'))
      })
    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [data])

  useEffect(() => {
    if (error) onStatus({ failed: error })
  }, [error, onStatus])

  // Fit the page width to the panel, then apply the zoom.
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    // Settle first: re-rendering every visible page on each frame of a resize is slow.
    let timer = 0
    let sized = false
    const observer = new ResizeObserver(([entry]) => {
      window.clearTimeout(timer)
      const next = entry.contentRect.width
      // The first width applies at once, so the document appears without a wait.
      timer = window.setTimeout(() => setWidth(next), sized ? 150 : 0)
      sized = true
    })
    observer.observe(element)
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [])

  // Find the passage in the hit's pages and the query terms in the same window.
  const targetKey = target ? `${target.pageStart}:${target.pageEnd}:${target.text.length}` : 'none'
  useEffect(() => {
    if (!pdf) return
    let cancelled = false
    const first = Math.max(1, (target?.pageStart ?? 1) - WINDOW)
    const last = Math.min(pdf.numPages, (target?.pageEnd ?? 1) + WINDOW)
    void (async () => {
      const pages: Array<{ number: number; runs: { text: string; eol: boolean }[] }> = []
      for (let number = first; number <= last; number++) {
        const page = await pdf.getPage(number)
        pages.push({ number, runs: textRuns(await page.getTextContent()) })
      }
      if (cancelled) return
      // One haystack across the window, so a sentence that crosses a page still matches.
      const all = pages.flatMap((page) => page.runs)
      const text = new RunText(all)
      const startPage = pages.findIndex((page) => page.number === target?.pageStart)
      const offset = pages.slice(0, Math.max(0, startPage)).reduce((sum, page) => sum + page.runs.length, 0)
      const located = text.locate(target?.text ?? null, terms, text.offsetOfRun(offset))

      // Split the window's run numbers back into page and item.
      const owner: Array<{ page: number; item: number }> = []
      for (const page of pages) page.runs.forEach((_, item) => owner.push({ page: page.number, item }))
      const byPage: Marks = new Map()
      const add = (kind: 'passage' | 'terms', group: Piece[]) => {
        const perPage = new Map<number, Piece[]>()
        for (const piece of group) {
          const { page, item } = owner[piece.run]
          perPage.set(page, [...(perPage.get(page) ?? []), { ...piece, run: item }])
        }
        for (const [page, pieces] of perPage) {
          const entry = byPage.get(page) ?? { passage: [], terms: [] }
          entry[kind].push(pieces)
          byPage.set(page, entry)
        }
      }
      located.passage.forEach((group) => add('passage', group))
      located.terms.forEach((group) => add('terms', group))
      setMarks(byPage)
      onStatus({ pages: pdf.numPages, coverage: target ? located.coverage : null })
    })()
    return () => {
      cancelled = true
    }
    // targetKey stands for target; terms is a fresh array on every render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, targetKey, terms.join('\u0000'), onStatus])

  const scale = base && width ? ((width - 2 * SIDE_PADDING) / base.width) * zoom : 0
  const pageHeight = base ? base.height * scale : 0

  // Which page is in view: for the page indicator, and to decide which pages to keep
  // drawn (the ones near it, see KEEP).
  const [inView, setInView] = useState(target?.pageStart ?? 1)
  useEffect(() => {
    const element = scrollRef.current
    if (!element || !pdf || !pageHeight) return
    let shown = 0
    const onScroll = () => {
      const middle = element.scrollTop + element.clientHeight / 3
      const page = Math.min(pdf.numPages, Math.max(1, Math.floor(middle / (pageHeight + PAGE_GAP)) + 1))
      if (page === shown) return
      shown = page
      setInView(page)
      onStatus({ page })
    }
    onScroll()
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [pdf, pageHeight, onStatus])

  // Before the highlight is painted, start at the hit's page, so nothing jumps far. Once
  // per passage: a zoom or a status update must not pull the reader back.
  const pageStart = target?.pageStart ?? 1
  const pageEnd = target?.pageEnd ?? 1
  const startedFor = useRef<string | null>(null)
  useEffect(() => {
    const element = scrollRef.current
    if (!element || !pageHeight || !target || startedFor.current === targetKey) return
    startedFor.current = targetKey
    element.scrollTop = (pageStart - 1) * (pageHeight + PAGE_GAP)
    // Said here too, not left to the scroll event: until it fires, the first pages
    // would count as in view and be drawn for nothing.
    setInView(pageStart)
    // target is represented by targetKey and pageStart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageHeight, targetKey, pageStart])

  const eager = useMemo(() => {
    const pages = new Set<number>()
    for (let page = pageStart - WINDOW; page <= pageEnd + WINDOW; page++) pages.add(page)
    return pages
  }, [pageStart, pageEnd])

  // Drawn within KEEP pages of the one in view, released only beyond KEEP + 2, so
  // scrolling back and forth over a page boundary does not redraw the same pages.
  const nearRef = useRef(new Set<number>())
  const nearPages = useMemo(() => {
    const next = new Set<number>()
    for (let page = 1; page <= (pdf?.numPages ?? 0); page++) {
      const distance = Math.abs(page - inView)
      if (eager.has(page) || distance <= KEEP || (nearRef.current.has(page) && distance <= KEEP + 2)) {
        next.add(page)
      }
    }
    nearRef.current = next
    return next
  }, [pdf, inView, eager])

  /** The first painted passage box: bring it to the upper third of the view, once. */
  const scrollToMark = useCallback(
    (box: HTMLElement) => {
      const element = scrollRef.current
      if (!element || scrolledFor.current === targetKey) return
      scrolledFor.current = targetKey
      const top =
        box.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop
      element.scrollTo({ top: Math.max(0, top - element.clientHeight / 3) })
    },
    [targetKey],
  )

  if (error) return null

  return (
    <div className="pdf-view" ref={scrollRef} data-testid="pdf-view">
      {pdf && scale > 0
        ? Array.from({ length: pdf.numPages }, (_, index) => (
            <PdfPage
              key={index + 1}
              pdf={pdf}
              number={index + 1}
              scale={scale}
              placeholderHeight={pageHeight}
              near={nearPages.has(index + 1)}
              marks={marks.get(index + 1)}
              onPassagePainted={scrollToMark}
            />
          ))
        : null}
    </div>
  )
}

function textRuns(content: { items: unknown[] }): { text: string; eol: boolean }[] {
  // Only text items become spans in the text layer, in this order, so the run index is
  // the span index.
  return (content.items as Array<Partial<TextItem>>)
    .filter((item) => typeof item.str === 'string')
    .map((item) => ({ text: item.str!, eol: !!item.hasEOL }))
}

const PdfPage = memo(function PdfPage({
  pdf,
  number,
  scale,
  placeholderHeight,
  near,
  marks,
  onPassagePainted,
}: {
  pdf: PDFDocumentProxy
  number: number
  scale: number
  placeholderHeight: number
  /** Drawn when near the page in view, released when not. */
  near: boolean
  marks?: { passage: Piece[][]; terms: Piece[][] }
  onPassagePainted: (box: HTMLElement) => void
}) {
  const pageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const marksRef = useRef<HTMLDivElement>(null)
  const [layer, setLayer] = useState<TextLayer | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  // Released when it scrolls away from the view: a canvas is several megabytes, and a
  // long PDF would otherwise keep every page it has ever shown.
  const drawn = useRef(false)
  useEffect(() => {
    if (near || !drawn.current) return
    drawn.current = false
    const canvas = canvasRef.current
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
    textRef.current?.replaceChildren()
    let cancelled = false
    void pdf.getPage(number).then((page) => {
      if (!cancelled) page.cleanup()
    })
    return () => {
      cancelled = true
    }
  }, [near, pdf, number])

  // Draw the canvas and the text layer, again whenever the scale changes.
  useEffect(() => {
    if (!near) return
    let cancelled = false
    let page: PDFPageProxy | null = null
    let task: { cancel: () => void } | null = null
    let textLayer: TextLayer | null = null
    void (async () => {
      page = await pdf.getPage(number)
      if (cancelled) return
      drawn.current = true
      const viewport = page.getViewport({ scale })
      setSize({ width: viewport.width, height: viewport.height })
      const canvas = canvasRef.current
      const text = textRef.current
      if (!canvas || !text) return
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const render = page.render({
        canvas,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      })
      task = render
      text.replaceChildren()
      textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: text,
        viewport,
      })
      await Promise.all([render.promise, textLayer.render()])
      if (!cancelled) setLayer(textLayer)
    })().catch(() => undefined)
    return () => {
      cancelled = true
      task?.cancel()
      textLayer?.cancel()
      setLayer(null)
    }
  }, [near, pdf, number, scale])

  // Paint the marks over the text layer once both exist.
  useEffect(() => {
    const host = marksRef.current
    const pageElement = pageRef.current
    if (!host || !pageElement) return
    host.replaceChildren()
    if (!layer || !marks) return
    const frame = requestAnimationFrame(() => {
      const origin = pageElement.getBoundingClientRect()
      let first: HTMLElement | null = null
      const paint = (groups: Piece[][], className: string) => {
        for (const group of groups) {
          for (const piece of group) {
            const span = layer.textDivs[piece.run]
            const node = span?.firstChild
            if (!node || node.nodeType !== Node.TEXT_NODE) continue
            const range = document.createRange()
            range.setStart(node, Math.min(piece.start, node.textContent!.length))
            range.setEnd(node, Math.min(piece.end, node.textContent!.length))
            for (const rect of range.getClientRects()) {
              const box = document.createElement('div')
              box.className = className
              box.style.left = `${rect.left - origin.left}px`
              box.style.top = `${rect.top - origin.top}px`
              box.style.width = `${rect.width}px`
              box.style.height = `${rect.height}px`
              host.append(box)
              if (className === 'passage-hit' && !first) first = box
            }
          }
        }
      }
      paint(marks.terms, 'term-hit')
      paint(marks.passage, 'passage-hit')
      if (first) onPassagePainted(first)
    })
    return () => cancelAnimationFrame(frame)
  }, [layer, marks, onPassagePainted])

  const height = size?.height ?? placeholderHeight
  return (
    <div
      ref={pageRef}
      className="pdf-page"
      data-page={number}
      style={{
        width: size?.width,
        height,
        marginBottom: PAGE_GAP,
        ['--scale-factor' as string]: scale,
        ['--total-scale-factor' as string]: scale,
        ['--scale-round-x' as string]: '1px',
        ['--scale-round-y' as string]: '1px',
      }}
    >
      <canvas ref={canvasRef} />
      <div ref={textRef} className="textLayer" />
      <div ref={marksRef} className="pdf-marks" aria-hidden="true" />
    </div>
  )
})
