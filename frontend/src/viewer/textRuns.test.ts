// frontend/src/viewer/textRuns.test.ts
import { describe, expect, it } from 'vitest'
import { RunText } from './textRuns'

describe('RunText', () => {
  const runs = [
    { text: 'Chapter 4', eol: true },
    { text: 'Replace the seal every', eol: false },
    { text: ' 2,000 hours of', eol: true },
    { text: 'operation. Other text.', eol: true },
  ]

  it('maps a passage spread over several runs back to the characters of each', () => {
    const located = new RunText(runs).locate('Replace the seal every 2,000 hours of operation.', [])
    expect(located.coverage).toBe(1)
    expect(located.passage).toEqual([
      [
        { run: 1, start: 0, end: 22 },
        { run: 2, start: 0, end: 15 },
        { run: 3, start: 0, end: 10 },
      ],
    ])
  })

  it('finds every occurrence of each query term', () => {
    const located = new RunText(runs).locate(null, ['seal', 'OPERATION'])
    expect(located.terms).toEqual([
      [{ run: 1, start: 12, end: 16 }],
      [{ run: 3, start: 0, end: 9 }],
    ])
  })

  it('gives the normalised offset where a run starts', () => {
    const text = new RunText(runs)
    expect(text.normalised.text.slice(text.offsetOfRun(3))).toMatch(/^operation\./)
  })
})
