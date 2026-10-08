// frontend/src/pages/searchPath.ts

/** The results route for a query. The query lives in the URL, so Back and bookmarks work. */
export function searchPath(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`
}
