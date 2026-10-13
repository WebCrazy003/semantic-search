// frontend/src/app/recentSearches.ts
// The searches someone ran last, newest first, for the shortcuts under the home page's
// box and the list that drops down from either box. Kept in localStorage, never sent
// anywhere, and kept apart per account: on a shared machine one person's searches are
// not shown to the next, nor to a visitor.

const STORAGE_PREFIX = 'docsage.recentSearches.'
const KEEP = 8

/** Whose history: the account's id, or everyone not logged in. */
export type HistoryOwner = string | null

function storageKey(owner: HistoryOwner): string {
  return STORAGE_PREFIX + (owner ?? 'visitor')
}

export function readRecentSearches(owner: HistoryOwner): string[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey(owner)) ?? '[]')
    return Array.isArray(stored)
      ? stored.filter((item): item is string => typeof item === 'string').slice(0, KEEP)
      : []
  } catch {
    // Private browsing, a disabled store, or malformed JSON: no history, nothing broken.
    return []
  }
}

function write(owner: HistoryOwner, searches: string[]): string[] {
  try {
    window.localStorage.setItem(storageKey(owner), JSON.stringify(searches))
  } catch {
    // Storage being unavailable must not stop the search itself.
  }
  return searches
}

/**
 * Puts a query at the front, once: running an old search again moves it up. Case does
 * not make a different search, so "Filter" replaces "filter".
 */
export function rememberSearch(owner: HistoryOwner, query: string): string[] {
  const lower = query.toLowerCase()
  const rest = readRecentSearches(owner).filter((item) => item.toLowerCase() !== lower)
  return write(owner, [query, ...rest].slice(0, KEEP))
}

export function forgetSearch(owner: HistoryOwner, query: string): string[] {
  return write(owner, readRecentSearches(owner).filter((item) => item !== query))
}
