// frontend/src/components/FolderPanel.tsx
import { FolderOpenOutlined } from '@ant-design/icons'
import { Button, Input, List, Popconfirm, Space, Tag, Typography } from 'antd'
import { useState } from 'react'
import type { FolderSummary } from '../services/api'

interface Props {
  folders: FolderSummary[]
  busy: boolean
  running: boolean
  onAdd: (path: string) => Promise<boolean>
  onRemove: (path: string) => void
}

export function FolderPanel({ folders, busy, running, onAdd, onRemove }: Props) {
  const [path, setPath] = useState('')
  const blocked = busy || running

  async function submit() {
    if (await onAdd(path)) setPath('')
  }

  return (
    <div className="folder-panel">
      <Typography.Paragraph type="secondary">
        A folder is read where it is. Nothing is copied, and the index stores the real path of
        every PDF and Word file, including the ones in subfolders.
      </Typography.Paragraph>

      <Space.Compact className="folder-row">
        <Input
          aria-label="Folder path to index in place"
          placeholder="/Users/you/Documents/manuals"
          prefix={<FolderOpenOutlined />}
          value={path}
          spellCheck={false}
          onChange={(event) => setPath(event.target.value)}
          onPressEnter={(event) => {
            event.preventDefault()
            void submit()
          }}
        />
        <Button type="primary" onClick={() => void submit()} disabled={blocked || !path.trim()}>
          Add folder
        </Button>
      </Space.Compact>

      <Typography.Paragraph type="secondary" className="hint-small">
        Paste the full path. In Finder, right-click the folder, hold Option, and choose “Copy as
        Pathname”. The browser cannot read a folder you pick with a file dialog, which is why this
        is typed rather than browsed.
      </Typography.Paragraph>

      <List
        size="small"
        dataSource={folders}
        locale={{ emptyText: 'No folders registered.' }}
        renderItem={(folder) => (
          <List.Item
            className={folder.readable ? undefined : 'folder-missing'}
            actions={
              folder.is_default
                ? []
                : [
                    <Popconfirm
                      key="remove"
                      title="Stop indexing this folder?"
                      description={`${folder.indexed_documents} document${
                        folder.indexed_documents === 1 ? '' : 's'
                      } will be removed from the index. The files stay on disk.`}
                      okText="Remove"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => onRemove(folder.path)}
                      disabled={blocked}
                    >
                      <Button
                        type="text"
                        danger
                        size="small"
                        disabled={blocked}
                        aria-label={`Stop indexing ${folder.path}`}
                      >
                        Remove
                      </Button>
                    </Popconfirm>,
                  ]
            }
          >
            <List.Item.Meta
              title={<code className="folder-path">{folder.path}</code>}
              description={
                <Space size={4} wrap>
                  {folder.is_default ? <Tag>default</Tag> : null}
                  {folder.readable ? (
                    <Typography.Text type="secondary">
                      {folder.document_count} document{folder.document_count === 1 ? '' : 's'} on
                      disk · {folder.indexed_documents} indexed
                    </Typography.Text>
                  ) : (
                    <Tag color="warning">not readable</Tag>
                  )}
                </Space>
              }
            />
          </List.Item>
        )}
      />
    </div>
  )
}
