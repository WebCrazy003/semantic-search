// frontend/src/hooks/useLibrary.ts
// One owner for the library: the document list and the current run.
// It lives above the router, so navigating never throws the state away and every page
// agrees about what is indexed.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearIndex,
  getDocuments,
  getIndexStatus,
  removeDocument,
  setVisibilityInBulk,
  startIndexing,
  uploadDocuments,
  type ClearResult,
  type DocumentSummary,
  type IndexStatus,
  type UploadResult,
  type Visibility,
} from '../services/api'

// Fast while a job runs, slow otherwise: the slow beat is what notices a job that
// something else started, so a second browser tab or a curl call never leaves this
// one showing stale counts.
const RUNNING_POLL_MS = 500
const IDLE_POLL_MS = 5000

export interface Library {
  documents: DocumentSummary[]
  /** False until the first refresh has settled, so "empty" is not confused with "not asked yet". */
  loaded: boolean
  status: IndexStatus | null
  error: string | null
  busy: boolean
  lastUpload: UploadResult | null
  lastClear: ClearResult | null
  refresh: () => Promise<void>
  importFiles: (files: File[]) => Promise<void>
  remove: (documentId: string) => Promise<void>
  clearAll: () => Promise<void>
  /** Admins only: make documents public or private. */
  setVisibility: (documentIds: string[], visibility: Visibility) => Promise<void>
  dismissError: () => void
}

function message(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback
}

export function useLibrary(): Library {
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [status, setStatus] = useState<IndexStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lastUpload, setLastUpload] = useState<UploadResult | null>(null)
  const [lastClear, setLastClear] = useState<ClearResult | null>(null)
  const timer = useRef<number | undefined>(undefined)
  // Files saved while another run was going; they are indexed as soon as it ends.
  const pendingUpload = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextDocuments] = await Promise.all([getIndexStatus(), getDocuments()])
      setStatus(nextStatus)
      setDocuments(nextDocuments)
      setError(null)
    } catch (caught) {
      setError(message(caught, 'Could not reach the backend'))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    const period = status?.status === 'running' ? RUNNING_POLL_MS : IDLE_POLL_MS
    timer.current = window.setInterval(() => void refresh(), period)
    return () => {
      if (timer.current !== undefined) window.clearInterval(timer.current)
    }
  }, [refresh, status?.status])

  useEffect(() => {
    if (!pendingUpload.current || !status || status.status === 'running') return
    pendingUpload.current = false
    startIndexing({ trigger: 'upload' })
      .then((started) => {
        // Someone else got in first; try again when that run ends.
        if (started.status === 'already_running') pendingUpload.current = true
        return refresh()
      })
      .catch((caught: unknown) => setError(message(caught, 'Could not start indexing')))
  }, [refresh, status])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const importFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setBusy(true)
      setLastClear(null)
      try {
        const result = await uploadDocuments(files)
        setLastUpload(result)
        // Importing is only useful if the new files become searchable, so the run
        // starts here rather than leaving the user to press a second button.
        if (result.saved.length > 0) {
          const started = await startIndexing({ trigger: 'upload' })
          if (started.status === 'already_running') {
            pendingUpload.current = true
            setError(
              'Your files are saved. Another indexing run is in progress; they are indexed as soon as it ends.',
            )
          }
        }
        await refresh()
      } catch (caught) {
        setError(message(caught, 'Could not import the files'))
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const remove = useCallback(
    async (documentId: string) => {
      setBusy(true)
      try {
        await removeDocument(documentId)
        await refresh()
      } catch (caught) {
        setError(message(caught, 'Could not remove the document'))
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const clearAll = useCallback(async () => {
    setBusy(true)
    setLastUpload(null)
    try {
      setLastClear(await clearIndex())
      await refresh()
    } catch (caught) {
      setError(message(caught, 'Could not clear the index'))
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const setVisibility = useCallback(
    async (documentIds: string[], visibility: Visibility) => {
      if (documentIds.length === 0) return
      setBusy(true)
      try {
        await setVisibilityInBulk(documentIds, visibility)
        await refresh()
      } catch (caught) {
        setError(message(caught, 'Could not change who can see the documents'))
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const dismissError = useCallback(() => setError(null), [])

  return {
    documents,
    loaded,
    status,
    error,
    busy,
    lastUpload,
    lastClear,
    refresh,
    importFiles,
    remove,
    clearAll,
    setVisibility,
    dismissError,
  }
}
