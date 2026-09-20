// frontend/src/pages/DocumentsPage.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { DocumentList } from '../components/DocumentList'
import { IndexStatus } from '../components/IndexStatus'
import {
  getDocuments,
  getIndexStatus,
  startIndexing,
  type DocumentSummary,
  type IndexStatus as Status,
} from '../services/api'

const POLL_INTERVAL_MS = 2000

export function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextDocuments] = await Promise.all([getIndexStatus(), getDocuments()])
      setStatus(nextStatus)
      setDocuments(nextDocuments)
      setError(null)
      return nextStatus
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load documents')
      return null
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function tick() {
      const current = await refresh()
      if (cancelled) return
      // Only keep polling while a run is actually in progress.
      if (current?.status === 'running') {
        timer.current = window.setTimeout(tick, POLL_INTERVAL_MS)
      }
    }

    void tick()
    return () => {
      cancelled = true
      if (timer.current !== undefined) window.clearTimeout(timer.current)
    }
  }, [refresh])

  async function onIndex() {
    setBusy(true)
    try {
      await startIndexing()
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start indexing')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page">
      {error ? <p role="alert" className="error">{error}</p> : null}
      <IndexStatus status={status} busy={busy} onIndex={onIndex} />
      <DocumentList documents={documents} />
    </section>
  )
}
