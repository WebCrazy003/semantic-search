// frontend/src/viewer/passageMatch.test.ts
// The matcher behind the viewer's highlight (spec 2026-10-08 §2.3, acceptance V2.3, V2.4).
import { describe, expect, it } from 'vitest'
import { MIN_COVERAGE, findPassage, normalise, segments } from './passageMatch'

function highlighted(haystack: string, passage: string, near = 0): string[] {
  const { text, source } = normalise(haystack)
  return findPassage(text, passage, near).ranges.map(([start, end]) =>
    haystack.slice(source[start], source[end - 1] + 1),
  )
}

describe('normalise', () => {
  it('collapses whitespace and folds case and width', () => {
    expect(normalise('  Replace\n\tthe  ＦＩＬＴＥＲ ').text).toBe('replace the filter')
  })

  it('removes the spaces a PDF text layer puts inside CJK runs', () => {
    expect(normalise('在 更换 滤芯 之前').text).toBe('在更换滤芯之前')
    expect(normalise('필터를 교체 하기').text).toBe('필터를교체하기')
  })

  it('keeps the space between CJK and Latin', () => {
    expect(normalise('滤芯 PX-200 型号').text).toBe('滤芯 px-200 型号')
  })

  it('joins a word the PDF hyphenated across lines, but keeps a real hyphen', () => {
    expect(normalise('main-\ntenance interval').text).toBe('maintenance interval')
    expect(normalise('well-known tool').text).toBe('well-known tool')
    expect(normalise('PX-\n200').text).toBe('px- 200')
  })

  it('maps every normalised character back to the original', () => {
    const original = 'a  b­c'
    const { text, source } = normalise(original)
    expect(text).toBe('a bc')
    expect(source).toEqual([0, 1, 3, 5])
  })
})

describe('segments', () => {
  it('splits at sentence ends in every script and drops scraps', () => {
    expect(
      segments('Close the main valve first. Then wait.\n在更换滤芯之前，必须先关闭主电源开关。好。'),
      // NFKC folds the full-width comma; both sides of a match are folded alike.
    ).toEqual(['close the main valve first.', 'then wait.', '在更换滤芯之前,必须先关闭主电源开关。'])
  })
})

describe('findPassage', () => {
  it('finds a passage whose sentences sit on separate lines of the page', () => {
    const page =
      'Chapter 4 Maintenance\nReplace the seal every 2,000 hours of\noperation. Check the gasket monthly.\nOther text.'
    const passage = 'Replace the seal every 2,000 hours of operation. Check the gasket monthly.'
    expect(highlighted(page, passage)).toEqual([
      'Replace the seal every 2,000 hours of\noperation. Check the gasket monthly.',
    ])
  })

  it('finds a Chinese passage in a text layer split mid-word', () => {
    const page = '第一章 安全\n在更换 滤芯之前，必须先关闭 主电源开关。其他内容。'
    const passage = '在更换滤芯之前，必须先关闭主电源开关。'
    const { text } = normalise(page)
    expect(findPassage(text, passage).coverage).toBe(1)
  })

  it('ignores the overlap with the previous passage when it is not on the page', () => {
    const page = 'The pump must be primed before use. Never run it dry.'
    const passage = 'From the previous page, an unrelated ending sentence. The pump must be primed before use. Never run it dry.'
    const { text } = normalise(page)
    const match = findPassage(text, passage)
    expect(match.ranges).toEqual([[0, text.length]])
    expect(match.coverage).toBeGreaterThan(MIN_COVERAGE)
  })

  it('counts a sentence the page cut short by its start or its end', () => {
    const page = 'Replace the filter cartridge every six'
    const passage = 'Replace the filter cartridge every six months.'
    const { text } = normalise(page)
    expect(findPassage(text, passage).coverage).toBeGreaterThan(0.5)
  })

  it('prefers the occurrence nearest the expected position', () => {
    const page = 'Turn off the power first. ' + 'x'.repeat(500) + ' Turn off the power first.'
    const { text } = normalise(page)
    const [[start]] = findPassage(text, 'Turn off the power first.', text.length).ranges
    expect(start).toBeGreaterThan(400)
  })

  it('reports no coverage when nothing matches, so the viewer can fall back', () => {
    const { text } = normalise('Completely different words on this page.')
    expect(findPassage(text, 'Nothing here matches at all, not one sentence.')).toEqual({
      ranges: [],
      coverage: 0,
    })
  })
})
