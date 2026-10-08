// frontend/src/viewer/viewTypes.ts
// What DocumentViewer and the PDF and Word views it loads say to each other.

/** The passage to find and highlight. */
export interface Target {
  /** The passage text, without its repeated heading. */
  text: string
  pageStart: number
  pageEnd: number
}

export interface ViewStatus {
  pages?: number
  page?: number
  /** Share of the passage found, or null when there is no passage to find. */
  coverage?: number | null
  /** The file could not be shown. */
  failed?: string
}

export interface ViewProps {
  data: ArrayBuffer
  target: Target | null
  /** Query terms, highlighted more lightly than the passage. */
  terms: string[]
  zoom: number
  /** Stable (a useCallback): the views list it in effect dependencies. */
  onStatus: (patch: ViewStatus) => void
}
