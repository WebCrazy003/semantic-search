// frontend/src/pages/ViewerPage.tsx
// One document in a tab of its own (#/view/<id>?chunk=<n>&q=<query>), at full width,
// for reading a Word file or a PDF on the big screen (spec 2026-10-08 §2.1). With a
// chunk, the passage is fetched and highlighted as in the result panel; without one,
// as when opened from the document manager, the document opens at the top.
//
// Open to visitors for public documents, as the panel is.
import { Result } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../app/AuthContext'
import { withoutRepeatedHeading } from '../components/passage'
import { errorText, getPassage, type Passage } from '../services/api'
import { DocumentViewer } from '../viewer/DocumentViewer'

export function ViewerPage() {
  const { documentId = '' } = useParams()
  const [params] = useSearchParams()
  const { user } = useAuth()
  const chunk = params.get('chunk')
  const query = params.get('q') ?? undefined
  const chunkIndex = chunk !== null && /^\d+$/.test(chunk) ? Number(chunk) : undefined
  const [passage, setPassage] = useState<Passage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(chunkIndex === undefined)

  // Who is looking decides what may be read, so a login refetches.
  const who = user?.user_id ?? null
  useEffect(() => {
    if (chunkIndex === undefined) return
    let cancelled = false
    setReady(false)
    getPassage(documentId, chunkIndex)
      .then((found) => {
        if (cancelled) return
        setPassage(found)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorText(caught, 'No such document'))
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [documentId, chunkIndex, who])

  const target = useMemo(
    () =>
      passage
        ? {
            text: withoutRepeatedHeading(passage.text, passage.heading) || passage.text,
            pageStart: passage.page_start,
            pageEnd: passage.page_end,
          }
        : null,
    [passage],
  )

  useEffect(() => {
    if (passage) document.title = `${passage.filename} · DocSage`
  }, [passage])

  if (error) {
    return (
      <Result
        status="404"
        title="This document is not available"
        subTitle={user ? error : 'It may be private. Log in to see your own documents.'}
      />
    )
  }
  if (!ready) return null

  return (
    <div className="viewer-page">
      <DocumentViewer
        key={`${documentId}:${who}`}
        documentId={documentId}
        variant="full"
        query={query}
        filename={passage?.filename}
        target={target}
      />
    </div>
  )
}
