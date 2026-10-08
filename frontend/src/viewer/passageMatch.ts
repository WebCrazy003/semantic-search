// frontend/src/viewer/passageMatch.ts
// Finds a search hit's passage inside the text of the rendered document, so the viewer
// can highlight it (spec 2026-10-08 §2.3).
//
// The index stores no offsets, and the stored passage is not a clean substring of the
// page: it overlaps the previous passage, repeats its heading, and the extractor joined
// words the PDF split across lines. So both sides are normalised the same way and the
// passage is looked for sentence by sentence. Pure functions, no DOM: the PDF and Word
// viewers each build the haystack from their own text and map the ranges back.

const CJK = '\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uac00-\\ud7af\\u1100-\\u11ff\\u3130-\\u318f'
const CJK_CHAR = new RegExp(`[${CJK}]`)
const SENTENCE_END = /([。！？.!?;；]+)/
const MIN_SEGMENT = 8
// A segment that is not found whole counts if this much of it, from either end, is.
const PARTIAL = 0.6
// Below this share of the passage found, the viewer says so and falls back to the page.
export const MIN_COVERAGE = 0.3

export interface Normalised {
  /** The normalised text. */
  text: string
  /** For each character of `text`, the index in the original it came from. */
  source: number[]
}

/**
 * NFKC, lower case, soft hyphens and end-of-line hyphens dropped, whitespace collapsed to
 * one space, and no space between two CJK characters, which PDF text layers split at
 * arbitrary points.
 */
export function normalise(original: string): Normalised {
  let text = ''
  const source: number[] = []
  // Where a run of whitespace began, while one is pending; -1 otherwise.
  let space = -1

  for (let index = 0; index < original.length; index++) {
    const char = original[index]
    if (char === '\u00ad') continue
    // "main-\ntenance": a hyphen that ends a line inside a word is the PDF's, not the
    // text's. The extractor joined these words, so the passage has them whole.
    if (char === '-' && /[a-z]/i.test(original[index - 1] ?? '')) {
      const after = /^\r?\n[ \t]*/.exec(original.slice(index + 1))
      if (after && /[a-z]/.test(original[index + 1 + after[0].length] ?? '')) {
        index += after[0].length
        continue
      }
    }
    if (/\s/.test(char)) {
      if (text.length > 0 && space === -1) space = index
      continue
    }
    const folded = char.normalize('NFKC').toLowerCase()
    if (space !== -1) {
      const previous = text[text.length - 1]
      if (!(CJK_CHAR.test(previous) && CJK_CHAR.test(folded[0] ?? ''))) {
        text += ' '
        source.push(space)
      }
      space = -1
    }
    for (const piece of folded) {
      text += piece
      source.push(index)
    }
  }
  return { text, source }
}

/** The passage, cut at sentence ends and line breaks into pieces worth looking for. */
export function segments(passage: string): string[] {
  const pieces: string[] = []
  for (const line of passage.split(/\n+/)) {
    const parts = line.split(SENTENCE_END)
    // Re-attach each sentence's closing punctuation to it.
    for (let index = 0; index < parts.length; index += 2) {
      const sentence = normalise(parts[index] + (parts[index + 1] ?? '')).text.trim()
      if (sentence.length >= MIN_SEGMENT) pieces.push(sentence)
    }
  }
  return pieces
}

export interface Match {
  /** Ranges in the haystack's normalised text, [start, end), sorted and not overlapping. */
  ranges: Array<[number, number]>
  /** The share of the passage's characters that were found, 0 to 1. */
  coverage: number
}

/**
 * Every segment of the passage found in the haystack. `near`, a normalised offset,
 * breaks ties between repeats (the approximate page of a Word hit): the closest wins.
 */
export function findPassage(haystack: string, passage: string, near = 0): Match {
  const pieces = segments(passage)
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0)
  if (total === 0 || !haystack) return { ranges: [], coverage: 0 }

  const ranges: Array<[number, number]> = []
  let found = 0
  for (const piece of pieces) {
    const whole = closest(haystack, piece, near)
    if (whole !== -1) {
      ranges.push([whole, whole + piece.length])
      found += piece.length
      continue
    }
    const part = Math.ceil(piece.length * PARTIAL)
    const head = closest(haystack, piece.slice(0, part), near)
    if (head !== -1) {
      ranges.push([head, head + part])
      found += part
      continue
    }
    const tail = closest(haystack, piece.slice(piece.length - part), near)
    if (tail !== -1) {
      ranges.push([tail, tail + part])
      found += part
    }
  }
  return { ranges: merge(ranges), coverage: found / total }
}

function closest(haystack: string, needle: string, near: number): number {
  let best = -1
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    if (best === -1 || Math.abs(at - near) < Math.abs(best - near)) best = at
  }
  return best
}

function merge(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1]
    // Sentences found back to back (one space apart) read as one highlight.
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}
