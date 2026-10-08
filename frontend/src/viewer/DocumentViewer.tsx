// frontend/src/viewer/DocumentViewer.tsx
// The document itself, in the result panel or in a tab of its own (spec 2026-10-08 §2):
// fetched from /api/documents/{id}/file, shown by the PDF or Word view, scrolled to the
// passage and with it highlighted. pdf.js and docx-preview load only when a document of
// their kind is first opened, so the home page stays light.
import {
  DownloadOutlined,
  ExportOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons'
import { Alert, Button, Result, Space, Spin, Tooltip, Typography } from 'antd'
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { highlightTerms } from '../components/passage'
import { documentFileUrl, errorText, fetchDocumentFile, type DocumentFile } from '../services/api'
import { useSettings } from '../settings/SettingsContext'
import { MIN_COVERAGE } from './passageMatch'
import type { Target, ViewStatus } from './viewTypes'

const PdfView = lazy(() => import('./PdfView'))
const DocxView = lazy(() => import('./DocxView'))

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

/** The route of the full-tab viewer for a document, and a passage in it when known. */
export function viewerPath(documentId: string, chunkIndex?: number, query?: string): string {
  const params = new URLSearchParams()
  if (chunkIndex !== undefined) params.set('chunk', String(chunkIndex))
  if (query) params.set('q', query)
  const search = params.toString()
  return `/view/${documentId}${search ? `?${search}` : ''}`
}

interface Props {
  documentId: string
  /** The passage to find; null opens the document at the top with nothing marked. */
  target: Target | null
  query?: string
  /** Shown in the toolbar until the file says its own name. */
  filename?: string
  /** For "Open in new tab": the passage, by number. Omitted in the full-tab view. */
  chunkIndex?: number
  variant: 'panel' | 'full'
  /** What to show instead when the file cannot be rendered, under the message. */
  fallback?: ReactNode
}

export function DocumentViewer({
  documentId,
  target,
  query,
  filename,
  chunkIndex,
  variant,
  fallback,
}: Props) {
  const { settings } = useSettings()
  const [file, setFile] = useState<DocumentFile | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState<ViewStatus>({})
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const controller = new AbortController()
    setFile(null)
    setLoadError(null)
    setStatus({})
    fetchDocumentFile(documentId, controller.signal)
      .then(setFile)
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(errorText(caught, 'Could not load the file'))
      })
    return () => controller.abort()
  }, [documentId])

  const onStatus = useCallback((patch: ViewStatus) => {
    setStatus((current) => {
      const changed = (Object.keys(patch) as (keyof ViewStatus)[]).some(
        (key) => patch[key] !== current[key],
      )
      return changed ? { ...current, ...patch } : current
    })
  }, [])

  const terms = useMemo(
    () => (settings.highlightTerms ? highlightTerms(query) : []),
    [query, settings.highlightTerms],
  )

  const failed = loadError ?? status.failed ?? (file && file.kind === 'other' ? 'unsupported' : null)
  const name = file?.filename ?? filename
  const step = (direction: 1 | -1) => {
    const index = ZOOM_STEPS.findIndex((value) => value >= zoom - 0.001)
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + direction))]
    setZoom(next)
  }

  const toolbar = (
    <div className="viewer-toolbar">
      <Typography.Text type="secondary" className="viewer-pages">
        {status.pages
          ? file?.kind === 'pdf'
            ? `Page ${status.page ?? 1} of ${status.pages}`
            : `About ${status.pages} ${status.pages === 1 ? 'page' : 'pages'}`
          : null}
      </Typography.Text>
      <Space size={2}>
        <Tooltip title="Zoom out">
          <Button
            type="text"
            size="small"
            aria-label="Zoom out"
            icon={<ZoomOutOutlined aria-hidden="true" />}
            onClick={() => step(-1)}
            disabled={zoom <= ZOOM_STEPS[0]}
          />
        </Tooltip>
        <Typography.Text className="viewer-zoom" aria-live="polite">
          {Math.round(zoom * 100)}%
        </Typography.Text>
        <Tooltip title="Zoom in">
          <Button
            type="text"
            size="small"
            aria-label="Zoom in"
            icon={<ZoomInOutlined aria-hidden="true" />}
            onClick={() => step(1)}
            disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
          />
        </Tooltip>
        {variant === 'panel' ? (
          <Tooltip title="Open in a new tab">
            <Button
              type="text"
              size="small"
              aria-label="Open in a new tab"
              icon={<ExportOutlined aria-hidden="true" />}
              href={`#${viewerPath(documentId, chunkIndex, query)}`}
              target="_blank"
              rel="noopener noreferrer"
            />
          </Tooltip>
        ) : null}
        <Tooltip title="Download">
          <Button
            type="text"
            size="small"
            aria-label="Download"
            icon={<DownloadOutlined aria-hidden="true" />}
            href={documentFileUrl(documentId)}
            download={name ?? true}
          />
        </Tooltip>
      </Space>
    </div>
  )

  let body: ReactNode
  if (failed) {
    body = (
      <div className="viewer-fallback">
        <Result
          status="warning"
          title="Can't preview this file"
          subTitle={failed === 'unsupported' ? undefined : failed}
          extra={
            <Button
              type="primary"
              icon={<DownloadOutlined aria-hidden="true" />}
              href={documentFileUrl(documentId)}
              download={name ?? true}
            >
              Download
            </Button>
          }
        />
        {fallback}
      </div>
    )
  } else if (!file) {
    body = (
      <div className="viewer-loading">
        <Spin />
      </div>
    )
  } else {
    const View = file.kind === 'pdf' ? PdfView : DocxView
    body = (
      <Suspense
        fallback={
          <div className="viewer-loading">
            <Spin />
          </div>
        }
      >
        <View data={file.data} target={target} terms={terms} zoom={zoom} onStatus={onStatus} />
      </Suspense>
    )
  }

  const missed =
    !failed && target && status.coverage !== undefined && status.coverage !== null
      ? status.coverage < MIN_COVERAGE
      : false

  return (
    <div className={`document-viewer document-viewer-${variant}`} data-testid="document-viewer">
      {toolbar}
      {missed && target ? (
        <Alert
          type="info"
          showIcon
          banner
          title={`Couldn't pinpoint the passage; showing ${
            target.pageStart === target.pageEnd
              ? `page ${target.pageStart}`
              : `pages ${target.pageStart} to ${target.pageEnd}`
          }.`}
        />
      ) : null}
      {body}
    </div>
  )
}
