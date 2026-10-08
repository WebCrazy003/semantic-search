// frontend/src/viewer/DocxView.tsx
// A Word file, rendered in the browser by docx-preview, with the passage highlighted
// (spec 2026-10-08 §2.2, §2.3). Loaded on demand by DocumentViewer.
//
// Highlights use the CSS Custom Highlight API: ranges over the rendered text, painted by
// the browser, with no change to the document's DOM. A browser without it falls back to
// wrapping the passage in <mark>.
import { renderAsync } from 'docx-preview'
import { useEffect, useRef, useState } from 'react'
import { errorText } from '../services/api'
import { RunText, type Piece } from './textRuns'
import type { ViewProps } from './viewTypes'

const BLOCK = 'p, li, td, th, h1, h2, h3, h4, h5, h6, tr, section'
const PASSAGE = 'docsage-passage'
const TERM = 'docsage-term'

interface HighlightRegistry {
  set: (name: string, highlight: unknown) => void
  delete: (name: string) => void
}

function registry(): HighlightRegistry | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS
  const Highlight = (globalThis as { Highlight?: unknown }).Highlight
  return css?.highlights && Highlight ? css.highlights : null
}

export default function DocxView({ data, target, terms, zoom, onStatus }: ViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const [rendered, setRendered] = useState(0)

  useEffect(() => {
    const body = bodyRef.current
    const style = styleRef.current
    if (!body || !style) return
    let cancelled = false
    body.replaceChildren()
    style.replaceChildren()
    renderAsync(data.slice(0), body, style, {
      className: 'docx',
      inWrapper: true,
      breakPages: true,
      // The extractor counts pages by these markers, so the viewer's pages match the
      // "Page ~n" a result shows.
      ignoreLastRenderedPageBreak: false,
      experimental: true,
      useBase64URL: true,
    })
      .then(() => {
        if (cancelled) return
        onStatus({ pages: body.querySelectorAll('section.docx').length || 1 })
        setRendered((count) => count + 1)
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          onStatus({ failed: errorText(caught, 'Cannot read this file') })
        }
      })
    return () => {
      cancelled = true
    }
  }, [data, onStatus])

  // Find and mark the passage and the query terms in the rendered text.
  const termsKey = terms.join('\u0000')
  useEffect(() => {
    const body = bodyRef.current
    const scroller = scrollRef.current
    if (!rendered || !body || !scroller) return
    const nodes = textNodes(body)
    const runs = nodes.map((node, index) => ({
      text: node.data,
      eol: index === nodes.length - 1 || blockOf(node) !== blockOf(nodes[index + 1]),
    }))
    const text = new RunText(runs)
    const sections = [...body.querySelectorAll('section.docx')]
    const nearSection = sections[Math.max(0, (target?.pageStart ?? 1) - 1)]
    const nearRun = nearSection ? nodes.findIndex((node) => nearSection.contains(node)) : 0
    const located = text.locate(target?.text ?? null, terms, text.offsetOfRun(Math.max(0, nearRun)))
    onStatus({ coverage: target ? located.coverage : null })

    const toRanges = (groups: Piece[][]) =>
      groups.flatMap((group) =>
        group.map((piece) => {
          const range = document.createRange()
          range.setStart(nodes[piece.run], piece.start)
          range.setEnd(nodes[piece.run], piece.end)
          return range
        }),
      )
    const passageRanges = toRanges(located.passage)
    const termRanges = toRanges(located.terms)

    const highlights = registry()
    const unwrap: Array<() => void> = []
    if (highlights) {
      const Highlight = (globalThis as unknown as { Highlight: new (...ranges: Range[]) => unknown })
        .Highlight
      highlights.set(TERM, new Highlight(...termRanges))
      highlights.set(PASSAGE, new Highlight(...passageRanges))
    } else {
      // Last range first, so wrapping one does not shift the offsets of the next.
      for (const range of [...passageRanges].reverse()) {
        const mark = document.createElement('mark')
        mark.className = 'passage-hit-mark'
        try {
          range.surroundContents(mark)
          unwrap.push(() => mark.replaceWith(...mark.childNodes))
        } catch {
          // A range across element boundaries cannot be wrapped; it stays unmarked.
        }
      }
    }

    // Bring the passage, or failing that the hit's page, to the upper third of the view.
    const anchor = passageRanges[0]?.getBoundingClientRect() ?? nearSection?.getBoundingClientRect()
    if (anchor) {
      const top = anchor.top - scroller.getBoundingClientRect().top + scroller.scrollTop
      scroller.scrollTo({ top: Math.max(0, top - scroller.clientHeight / 3) })
    }

    return () => {
      highlights?.delete(TERM)
      highlights?.delete(PASSAGE)
      for (const undo of unwrap) undo()
    }
    // target is compared by its text and pages; terms by their joined key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, target?.text, target?.pageStart, termsKey, onStatus])

  return (
    <div className="docx-view" ref={scrollRef} data-testid="docx-view">
      <div ref={styleRef} />
      <div ref={bodyRef} className="docx-body" style={{ zoom }} />
    </div>
  )
}

function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('style, script') || !node.textContent
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
  return nodes
}

function blockOf(node: Text): Element | null {
  return node.parentElement?.closest(BLOCK) ?? null
}
