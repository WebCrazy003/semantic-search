// frontend/src/viewer/textRuns.ts
// Between the matcher and the page. A viewer hands over its text as runs (a PDF text
// item, a Word text node, each with whether a line ends after it) and gets back, for
// the passage and for the query terms, which characters of which runs to mark. The
// viewers then only have to paint them.
import { findPassage, normalise, type Normalised } from './passageMatch'

export interface Run {
  text: string
  /** A line or block ends after this run. */
  eol: boolean
}

/** Characters [start, end) of one run. */
export interface Piece {
  run: number
  start: number
  end: number
}

export interface Located {
  /** One list of pieces per highlighted stretch of the passage, in reading order. */
  passage: Piece[][]
  /** One list per occurrence of a query term. */
  terms: Piece[][]
  /** The share of the passage found, 0 to 1. */
  coverage: number
}

export class RunText {
  readonly original: string
  readonly normalised: Normalised
  private readonly starts: number[]

  readonly runs: Run[]

  constructor(runs: Run[]) {
    this.runs = runs
    let original = ''
    this.starts = []
    for (const run of runs) {
      this.starts.push(original.length)
      original += run.text
      if (run.eol) original += '\n'
    }
    this.original = original
    this.normalised = normalise(original)
  }

  /** The normalised offset at which a run begins, for "find nearest to here". */
  offsetOfRun(run: number): number {
    const at = this.starts[Math.max(0, Math.min(run, this.starts.length - 1))] ?? 0
    const index = this.normalised.source.findIndex((source) => source >= at)
    return index === -1 ? this.normalised.text.length : index
  }

  locate(passage: string | null, terms: string[], near = 0): Located {
    const match = passage
      ? findPassage(this.normalised.text, passage, near)
      : { ranges: [], coverage: 0 }
    return {
      passage: match.ranges.map(([start, end]) => this.pieces(start, end)),
      terms: this.termRanges(terms).map(([start, end]) => this.pieces(start, end)),
      coverage: match.coverage,
    }
  }

  private termRanges(terms: string[]): Array<[number, number]> {
    const ranges: Array<[number, number]> = []
    const text = this.normalised.text
    for (const raw of terms) {
      const term = normalise(raw).text
      if (!term) continue
      for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + term.length)) {
        ranges.push([at, at + term.length])
      }
    }
    return ranges
  }

  /** A normalised range as pieces of runs, skipping the line breaks between them. */
  private pieces(start: number, end: number): Piece[] {
    const { source } = this.normalised
    const from = source[start]
    const to = source[end - 1] + 1
    const pieces: Piece[] = []
    for (let run = this.runAt(from); run < this.runs.length; run++) {
      const runStart = this.starts[run]
      if (runStart >= to) break
      const pieceStart = Math.max(from, runStart) - runStart
      const pieceEnd = Math.min(to, runStart + this.runs[run].text.length) - runStart
      if (pieceEnd > pieceStart) pieces.push({ run, start: pieceStart, end: pieceEnd })
    }
    return pieces
  }

  private runAt(offset: number): number {
    let low = 0
    let high = this.starts.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (this.starts[middle] <= offset) low = middle
      else high = middle - 1
    }
    return low
  }
}
