// frontend/src/components/drive/MoveDialog.tsx
// "Move to…": pick a folder in the same tree. A move is a database change only, so it
// is instant and nothing is indexed again (spec 2026-10-08 §0a).
import { FolderOutlined, HomeOutlined } from '@ant-design/icons'
import { Modal, Tree, type TreeDataNode } from 'antd'
import { useMemo, useState } from 'react'
import type { DriveFolder } from '../../services/api'

const ROOT = '__root__'

function nodes(folders: DriveFolder[], blocked: Set<string>): TreeDataNode[] {
  return folders.map((folder) => ({
    key: folder.folder_id,
    title: folder.name,
    icon: <FolderOutlined />,
    // A folder cannot go inside itself or anything below it.
    disabled: blocked.has(folder.folder_id),
    children: blocked.has(folder.folder_id) ? [] : nodes(folder.folders, blocked),
  }))
}

export function MoveDialog({
  open,
  rootName,
  folders,
  movingFolderIds,
  count,
  onCancel,
  onMove,
}: {
  open: boolean
  rootName: string
  folders: DriveFolder[]
  movingFolderIds: string[]
  count: number
  onCancel: () => void
  onMove: (to: string | null) => void
}) {
  const [target, setTarget] = useState<string>(ROOT)
  const data = useMemo<TreeDataNode[]>(
    () => [
      {
        key: ROOT,
        title: rootName,
        icon: <HomeOutlined />,
        children: nodes(folders, new Set(movingFolderIds)),
      },
    ],
    [folders, movingFolderIds, rootName],
  )
  return (
    <Modal
      title={`Move ${count} ${count === 1 ? 'item' : 'items'}`}
      open={open}
      onCancel={onCancel}
      onOk={() => onMove(target === ROOT ? null : target)}
      okText="Move here"
      destroyOnHidden
    >
      <Tree
        showIcon
        defaultExpandAll
        blockNode
        treeData={data}
        selectedKeys={[target]}
        onSelect={(keys) => keys.length && setTarget(String(keys[0]))}
        className="move-tree"
      />
    </Modal>
  )
}
