// frontend/src/components/drive/fileState.tsx
// How a file's place in indexing reads in the document manager and its upload panel.
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  ExclamationCircleFilled,
  FileUnknownOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons'
import { Tag, Tooltip } from 'antd'
import type { ReactNode } from 'react'

/** Every state a row can be in: the server's, plus the browser's own "uploading". */
export type RowState =
  | 'uploading'
  | 'waiting'
  | 'indexing'
  | 'indexed'
  | 'skipped'
  | 'unsupported'
  | 'failed'
  | 'duplicate'
  | 'not_indexed'
  | 'rejected'

const LOOK: Record<RowState, { label: string; color?: string; icon: ReactNode }> = {
  uploading: { label: 'Uploading', color: 'processing', icon: <CloudUploadOutlined /> },
  waiting: { label: 'Waiting to index', icon: <ClockCircleOutlined /> },
  indexing: { label: 'Indexing', color: 'processing', icon: <LoadingOutlined /> },
  indexed: { label: 'Indexed', color: 'success', icon: <CheckCircleFilled /> },
  skipped: { label: 'Indexed', color: 'success', icon: <CheckCircleFilled /> },
  unsupported: { label: 'No text', color: 'warning', icon: <FileUnknownOutlined /> },
  failed: { label: 'Failed', color: 'error', icon: <ExclamationCircleFilled /> },
  duplicate: { label: 'Duplicate', icon: <CopyOutlined /> },
  not_indexed: { label: 'Not indexed', color: 'default', icon: <MinusCircleOutlined /> },
  rejected: { label: 'Not uploaded', color: 'error', icon: <ExclamationCircleFilled /> },
}

const EXPLAIN: Partial<Record<RowState, string>> = {
  unsupported: 'No selectable text: a scanned PDF needs OCR before it can be searched.',
  duplicate: 'The same file is already indexed elsewhere in your documents.',
  not_indexed: 'Uploaded but not indexed yet. Use Index to index it now.',
  waiting: 'Indexing starts as soon as the run ahead of it finishes.',
}

export function stateLabel(state: RowState): string {
  return LOOK[state].label
}

/** Finished, one way or another: nothing more will happen without being asked. */
export function settled(state: RowState): boolean {
  return !['uploading', 'waiting', 'indexing'].includes(state)
}

/** Needs someone to look: the "need attention" filter. */
export function needsAttention(state: RowState): boolean {
  return state === 'failed' || state === 'unsupported' || state === 'not_indexed'
}

export function StateTag({ state, error }: { state: RowState; error?: string | null }) {
  const look = LOOK[state]
  const tag = (
    <Tag color={look.color} icon={look.icon} variant="filled" className="state-tag">
      {look.label}
    </Tag>
  )
  const why = error ?? EXPLAIN[state]
  return why ? <Tooltip title={why}>{tag}</Tooltip> : tag
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}
