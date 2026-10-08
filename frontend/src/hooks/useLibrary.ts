// frontend/src/hooks/useLibrary.ts
// The document list and the current run, for the pages that summarise them (the
// document manager's summary, the admin page). Uploading, deleting and indexing are the
// document manager's own calls now; this only keeps the picture current.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  errorText,
  getDocuments,
  getIndexStatus,
  type DocumentSummary,
  type IndexStatus,
} from '../services/api'

// Quicker while a run is going, slow otherwise: the slow beat is what notices a run
// that something else started, such as another tab or another user.
const RUNNING_POLL_MS = 1500
const IDLE_POLL_MS = 5000

export interface Library {
  documents: DocumentSummary[]
  /** False until the first refresh has settled, so "empty" is not confused with "not asked yet". */
  loaded: boolean
  status: IndexStatus | null
  error: string | null
  refresh: () => Promise<void>
}

/** What, in a run's status, means the document list may have changed. */
function progressKey(status: IndexStatus): string {
  return [
    status.job_id,
    status.status,
    status.processed_documents,
    status.indexed_documents,
    status.deleted_documents,
  ].join(':')
}

export function useLibrary(): Library {
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [status, setStatus] = useState<IndexStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const lastProgress = useRef<string | null>(null)
  const latest = useRef(0)

  /**
   * The status every time. The document list (every document there is) during a run
   * only when the run's counts moved, since it is by far the larger answer; while idle,
   * on every slow tick, so changes made elsewhere (another tab, another person) show up.
   * Answers that a later request has overtaken are dropped.
   */
  const poll = useCallback(async (force: boolean) => {
    const ticket = ++latest.current
    try {
      const nextStatus = await getIndexStatus()
      if (ticket !== latest.current) return
      setStatus((current) =>
        current && JSON.stringify(current) === JSON.stringify(nextStatus) ? current : nextStatus,
      )
      const progress = progressKey(nextStatus)
      if (force || nextStatus.status !== 'running' || progress !== lastProgress.current) {
        const nextDocuments = await getDocuments()
        if (ticket !== latest.current) return
        setDocuments(nextDocuments)
        // Only once the list arrived: a failed fetch is tried again on the next tick.
        lastProgress.current = progress
      }
      setError(null)
    } catch (caught) {
      if (ticket === latest.current) setError(errorText(caught, 'Could not reach the backend'))
    } finally {
      if (ticket === latest.current) setLoaded(true)
    }
  }, [])

  const refresh = useCallback(() => poll(true), [poll])

  const running = status?.status === 'running'
  useEffect(() => {
    const timer = window.setInterval(
      () => void poll(false),
      running ? RUNNING_POLL_MS : IDLE_POLL_MS,
    )
    return () => window.clearInterval(timer)
  }, [poll, running])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return useMemo(
    () => ({ documents, loaded, status, error, refresh }),
    [documents, loaded, status, error, refresh],
  )
}
