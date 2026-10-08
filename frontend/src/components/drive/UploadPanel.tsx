// frontend/src/components/drive/UploadPanel.tsx
// The small panel at the bottom right of the document manager (spec 2026-10-08 §3.4):
// one row per file, from uploading to waiting to indexing to its outcome, like Drive's
// upload panel. Indexing is the server's: closing the panel, or the tab, stops nothing.
import { CloseOutlined, DownOutlined, RedoOutlined, UpOutlined } from '@ant-design/icons'
import { Button, Progress, Tooltip, Typography } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  errorText,
  getIndexStatus,
  indexDriveFiles,
  listDrive,
  uploadToDrive,
  type DriveFile,
} from '../../services/api'
import { useSettings } from '../../settings/SettingsContext'
import { StateTag, settled, type RowState } from './fileState'

export interface UploadRow {
  key: string
  name: string
  state: RowState
  /** 0 to 1, while uploading or indexing. */
  progress: number
  stage?: string | null
  error?: string | null
  fileId?: string
  folderId: string | null
  documentId?: string | null
}

const FAST_POLL_MS = 1000

/**
 * The rows and what drives them. `onChanged` is called whenever a row moves on, so the
 * page can refresh the folder on screen.
 */
export function useUploads(onChanged: () => void) {
  const [rows, setRows] = useState<UploadRow[]>([])
  const counter = useRef(0)
  const changed = useRef(onChanged)
  useEffect(() => {
    changed.current = onChanged
  })

  const patch = useCallback((keys: string[], update: (row: UploadRow) => Partial<UploadRow>) => {
    setRows((current) =>
      current.map((row) => (keys.includes(row.key) ? { ...row, ...update(row) } : row)),
    )
  }, [])

  const upload = useCallback(
    async (files: File[], folderId: string | null) => {
      if (files.length === 0) return
      const batch = files.map((file) => ({
        key: `upload-${++counter.current}`,
        name: file.name,
        state: 'uploading' as RowState,
        progress: 0,
        folderId,
      }))
      setRows((current) => [...batch, ...current])
      const keys = batch.map((row) => row.key)
      try {
        const result = await uploadToDrive(files, folderId, (sent, total) =>
          patch(keys, () => ({ progress: total ? sent / total : 0 })),
        )
        const rejected = new Map(result.rejected.map((item) => [item.filename, item.reason]))
        // The server answers with the saved files in the order it accepted them; a name
        // it had to change (" (2)") still lines up by position.
        let saved = 0
        setRows((current) =>
          current.map((row) => {
            if (!keys.includes(row.key)) return row
            const reason = rejected.get(row.name)
            if (reason !== undefined) {
              rejected.delete(row.name)
              return { ...row, state: 'rejected', error: reason, progress: 0 }
            }
            const file = result.files[saved++]
            if (!file) return { ...row, state: 'rejected', error: 'Not saved', progress: 0 }
            return { ...row, state: 'waiting', name: file.name, fileId: file.file_id, progress: 0 }
          }),
        )
      } catch (caught) {
        const message = errorText(caught, 'Upload failed')
        patch(keys, () => ({ state: 'rejected', error: message, progress: 0 }))
      }
      changed.current()
    },
    [patch],
  )

  /** Index again, from the start: a failed file's Retry. */
  const retry = useCallback(
    async (row: UploadRow) => {
      if (!row.fileId) return
      patch([row.key], () => ({ state: 'waiting', error: null }))
      try {
        await indexDriveFiles('me', [row.fileId], true)
      } catch (caught) {
        patch([row.key], () => ({
          state: 'failed',
          error: errorText(caught, 'Could not start indexing'),
        }))
      }
      changed.current()
    },
    [patch],
  )

  const dismiss = useCallback(() => setRows([]), [])

  // While anything is waiting or indexing, ask the server how far it got: one interval
  // for as long as there is something to follow, so upload progress on another batch
  // (which changes rows many times a second) never postpones it.
  const rowsRef = useRef(rows)
  useEffect(() => {
    rowsRef.current = rows
  })
  const following = rows.some(
    (row) => row.fileId && (row.state === 'waiting' || row.state === 'indexing'),
  )
  useEffect(() => {
    if (!following) return
    let busy = false
    const timer = window.setInterval(async () => {
      if (busy) return
      busy = true
      try {
        const pending = rowsRef.current.filter((row) => row.fileId && !settled(row.state))
        const folders = [...new Set(pending.map((row) => row.folderId))]
        const [status, ...listings] = await Promise.all([
          getIndexStatus(),
          ...folders.map((folderId) => listDrive('me', folderId)),
        ])
        const byId = new Map<string, DriveFile>()
        for (const listing of listings) for (const file of listing.files) byId.set(file.file_id, file)
        let moved = false
        setRows((current) => {
          let touched = false
          const next = current.map((row) => {
            const file = row.fileId ? byId.get(row.fileId) : undefined
            if (!file || settled(row.state)) return row
            const indexingNow = file.state === 'indexing' && status.current_file === row.name
            const stage = indexingNow ? status.current_stage : null
            const progress = indexingNow ? status.current_file_progress : 0
            if (file.state === row.state && stage === (row.stage ?? null) && progress === row.progress) {
              return row
            }
            touched = true
            if (file.state !== row.state) moved = true
            return { ...row, state: file.state, error: file.error, documentId: file.document_id, stage, progress }
          })
          // Nothing new: keep the same array, so nothing re-renders.
          return touched ? next : current
        })
        if (moved) changed.current()
      } catch {
        // The next tick tries again.
      } finally {
        busy = false
      }
    }, FAST_POLL_MS)
    return () => window.clearInterval(timer)
  }, [following])

  return { rows, upload, retry, dismiss }
}

export function UploadPanel({
  rows,
  onRetry,
  onDismiss,
  onShow,
}: {
  rows: UploadRow[]
  onRetry: (row: UploadRow) => void
  onDismiss: () => void
  onShow: (row: UploadRow) => void
}) {
  const { reducedMotion } = useSettings()
  const [collapsed, setCollapsed] = useState(false)
  if (rows.length === 0) return null

  const uploading = rows.filter((row) => row.state === 'uploading').length
  const indexing = rows.filter((row) => row.state === 'waiting' || row.state === 'indexing').length
  const count = (states: RowState[]) => rows.filter((row) => states.includes(row.state)).length
  const done = count(['indexed', 'skipped', 'duplicate'])
  const noText = count(['unsupported'])
  const failed = count(['failed', 'rejected'])
  const outcome = [
    `${done} ${done === 1 ? 'file' : 'files'} indexed`,
    ...(noText ? [`${noText} without text`] : []),
    ...(failed ? [`${failed} failed`] : []),
  ].join(', ')
  const title = uploading
    ? `Uploading ${uploading} ${uploading === 1 ? 'file' : 'files'}`
    : indexing
      ? `Indexing ${rows.length - indexing} of ${rows.length}`
      : outcome

  return (
    <section className="upload-panel" aria-label="Uploads" data-testid="upload-panel">
      <header className="upload-panel-head">
        <Typography.Text strong>{title}</Typography.Text>
        <span>
          <Button
            type="text"
            size="small"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            icon={collapsed ? <UpOutlined /> : <DownOutlined />}
            onClick={() => setCollapsed(!collapsed)}
          />
          <Tooltip title={uploading ? 'Wait for the upload to finish' : 'Close; indexing carries on'}>
            <Button
              type="text"
              size="small"
              aria-label="Close"
              icon={<CloseOutlined />}
              disabled={uploading > 0}
              onClick={onDismiss}
            />
          </Tooltip>
        </span>
      </header>
      {collapsed ? null : (
        <ul className="upload-panel-rows">
          {rows.map((row) => (
            <li key={row.key} className="upload-row" data-state={row.state}>
              <div className="upload-row-main">
                {row.documentId && settled(row.state) ? (
                  <Typography.Link onClick={() => onShow(row)} ellipsis className="upload-row-name">
                    {row.name}
                  </Typography.Link>
                ) : (
                  <Typography.Text ellipsis className="upload-row-name">
                    {row.name}
                  </Typography.Text>
                )}
                <StateTag state={row.state} error={row.error} />
                {row.state === 'failed' && row.fileId ? (
                  <Button
                    type="text"
                    size="small"
                    icon={<RedoOutlined />}
                    onClick={() => onRetry(row)}
                  >
                    Retry
                  </Button>
                ) : null}
              </div>
              {row.state === 'uploading' || (row.state === 'indexing' && row.progress > 0) ? (
                <Progress
                  percent={Math.round(row.progress * 100)}
                  size="small"
                  showInfo={false}
                  status={reducedMotion ? 'normal' : 'active'}
                />
              ) : null}
              {row.state === 'indexing' && row.stage ? (
                <Typography.Text type="secondary" className="upload-row-stage">
                  {row.stage}
                </Typography.Text>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
