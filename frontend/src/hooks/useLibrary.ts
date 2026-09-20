// frontend/src/hooks/useLibrary.ts
// One owner for everything the Documents and Indexing tabs both need: the document
// list, the current run, and the job history. It lives in App so switching tabs never
// throws the state away, and so both tabs always agree about what is indexed.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearIndex,
  getDocuments,
  getIndexStatus,
  getJobs,
  removeDocument,
  startIndexing,
  uploadDocuments,
  type ClearResult,
  type DocumentSummary,
  type IndexStatus,
  type JobSummary,
  type UploadResult,
} from '../services/api'

// Fast while a job runs, slow otherwise: the slow beat is what notices a job that
// something else started, so a second browser tab or a curl call never leaves this
// one showing stale counts.
const RUNNING_POLL_MS = 1000
const IDLE_POLL_MS = 5000

export interface Library {
  documents: DocumentSummary[]
  status: IndexStatus | null
  jobs: JobSummary[]
  error: string | null
  busy: boolean
  lastUpload: UploadResult | null
  lastClear: ClearResult | null
  refresh: () => Promise<void>
  runIndexing: (force?: boolean) => Promise<void>
  importFiles: (files: File[]) => Promise<void>
  remove: (documentId: string) => Promise<void>
  clearAll: () => Promise<void>
  dismissError: () => void
}

function message(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback
}

export function useLibrary(): Library {
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [status, setStatus] = useState<IndexStatus | null>(null)
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastUpload, setLastUpload] = useState<UploadResult | null>(null)
  const [lastClear, setLastClear] = useState<ClearResult | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextDocuments, nextJobs] = await Promise.all([
        getIndexStatus(),
        getDocuments(),
        getJobs(),
      ])
      setStatus(nextStatus)
      setDocuments(nextDocuments)
      setJobs(nextJobs)
      setError(null)
    } catch (caught) {
      setError(message(caught, 'Could not reach the backend'))
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
    void refresh()
  }, [refresh])

  const runIndexing = useCallback(
    async (force = false) => {
      setBusy(true)
      setLastClear(null)
      try {
        const started = await startIndexing({ force })
        if (started.status === 'already_running') {
          setError('An indexing job is already running. Only one runs at a time.')
        }
        await refresh()
      } catch (caught) {
        setError(message(caught, 'Could not start indexing'))
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

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
            setError('Files were imported, but a job is already running. Index again when it ends.')
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

  const dismissError = useCallback(() => setError(null), [])

  return {
    documents,
    status,
    jobs,
    error,
    busy,
    lastUpload,
    lastClear,
    refresh,
    runIndexing,
    importFiles,
    remove,
    clearAll,
    dismissError,
  }
}
