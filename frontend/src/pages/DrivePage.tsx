// frontend/src/pages/DrivePage.tsx
// The document manager, in a tab of its own and laid out like Google Drive (spec
// 2026-10-08 §3): a rail with the folder tree, the files of one folder, uploads that
// index themselves, and moving files between folders.
//
// Folders are the database's, not the disk's, so a move is instant and never indexes
// anything again. Moves stay inside one owner's tree.
import {
  AppstoreOutlined,
  BarsOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ExportOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FolderAddOutlined,
  FolderFilled,
  FolderOutlined,
  GlobalOutlined,
  HomeOutlined,
  LockOutlined,
  PlusOutlined,
  ReloadOutlined,
  SwapOutlined,
  SyncOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import {
  App as AntApp,
  Alert,
  Breadcrumb,
  Button,
  Dropdown,
  Empty,
  Input,
  Menu,
  Segmented,
  Space,
  Table,
  Tag,
  Tooltip,
  Tree,
  Typography,
  type MenuProps,
  type TableColumnsType,
  type TreeDataNode,
} from 'antd'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react'
import { useAuth } from '../app/AuthContext'
import { useLibraryContext } from '../app/LibraryContext'
import { MoveDialog } from '../components/drive/MoveDialog'
import { UploadPanel, useUploads } from '../components/drive/UploadPanel'
import {
  StateTag,
  formatSize,
  needsAttention,
  type RowState,
} from '../components/drive/fileState'
import {
  createDriveFolder,
  deleteDriveFiles,
  deleteDriveFolder,
  documentFileUrl,
  errorText,
  getDriveTree,
  indexDriveFiles,
  listDrive,
  listUsers,
  moveDriveItems,
  renameDriveFolder,
  setVisibilityInBulk,
  type DocumentSummary,
  type DriveFile,
  type DriveFolder,
  type DriveListing,
  type DriveTree,
  type Visibility,
} from '../services/api'
import { viewerPath } from '../viewer/DocumentViewer'

type Place =
  | { kind: 'tree'; tree: string; folderId: string | null }
  | { kind: 'public' }

/** A row of the list: a folder or a file. Keys are prefixed so the two never collide. */
type Row =
  | { key: string; kind: 'folder'; folder: DriveFolder }
  | { key: string; kind: 'file'; file: DriveFile }

const DRAG_TYPE = 'application/x-docsage-items'
const LAYOUT_KEY = 'docsage.driveLayout'
const POLL_MS = 3000

function readLayout(): 'list' | 'grid' {
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

function openDocument(documentId: string) {
  window.open(`${window.location.pathname}#${viewerPath(documentId)}`, '_blank', 'noopener')
}

export function DrivePage() {
  const { user, isAdmin } = useAuth()
  const { message: toast, modal } = AntApp.useApp()
  const library = useLibraryContext()
  const [place, setPlace] = useState<Place>({ kind: 'tree', tree: 'me', folderId: null })
  const [listing, setListing] = useState<DriveListing | null>(null)
  const [tree, setTree] = useState<DriveTree | null>(null)
  const [users, setUsers] = useState<{ user_id: string; username: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [attention, setAttention] = useState(false)
  const [layout, setLayout] = useState<'list' | 'grid'>(readLayout)
  const [moving, setMoving] = useState<{ fileIds: string[]; folderIds: string[] } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [dropping, setDropping] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const treeName = place.kind === 'tree' ? place.tree : null
  const folderId = place.kind === 'tree' ? place.folderId : null
  const ownTree = treeName === 'me'

  useEffect(() => {
    document.title = 'Documents · DocSage'
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    listUsers()
      .then((found) => setUsers(found.map(({ user_id, username }) => ({ user_id, username }))))
      .catch(() => undefined)
  }, [isAdmin])

  // Each load is numbered: an answer for a folder the reader has since left, or one
  // overtaken by a later load, is dropped.
  const loadCount = useRef(0)
  const load = useCallback(
    async (withTree = true) => {
      if (place.kind !== 'tree') return
      const ticket = ++loadCount.current
      try {
        const [nextListing, nextTree] = await Promise.all([
          listDrive(place.tree, place.folderId),
          withTree ? getDriveTree(place.tree) : null,
        ])
        if (ticket !== loadCount.current) return
        setListing(nextListing)
        if (nextTree) setTree(nextTree)
        setError(null)
      } catch (caught) {
        if (ticket === loadCount.current) setError(errorText(caught, 'Could not load the folder'))
      }
    },
    [place],
  )

  useEffect(() => {
    setSelected([])
    setListing(null)
    void load()
  }, [load])

  // Keep the states current while anything here is on its way to being indexed. Only
  // the folder: states change, the tree does not. The next poll waits for this one.
  const busy = listing?.files.some((file) => file.state === 'waiting' || file.state === 'indexing')
  useEffect(() => {
    if (!busy) return
    let stopped = false
    let timer = 0
    const tick = async () => {
      await load(false)
      if (!stopped) timer = window.setTimeout(tick, POLL_MS)
    }
    timer = window.setTimeout(tick, POLL_MS)
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [busy, load])

  const refreshAll = useCallback(() => {
    void load()
    void library.refresh()
  }, [load, library])

  const uploads = useUploads(refreshAll)

  // ------------------------------------------------------------ the summary

  const mineInTree = useMemo(() => {
    if (place.kind !== 'tree') return [] as DocumentSummary[]
    return library.documents.filter((document) => {
      if (place.tree === 'me') return document.is_mine
      return document.owner_id === place.tree
    })
  }, [library.documents, place])
  const indexed = mineInTree.filter((document) => document.status === 'indexed')
  const passages = indexed.reduce((total, document) => total + document.chunks, 0)
  const troubled = mineInTree.filter(
    (document) => document.status === 'failed' || document.status === 'unsupported',
  ).length

  // ------------------------------------------------------------------ rows

  const rows = useMemo<Row[]>(() => {
    if (!listing) return []
    const term = filter.trim().toLowerCase()
    const matches = (name: string) => !term || name.toLowerCase().includes(term)
    const folders: Row[] = attention
      ? []
      : listing.folders
          .filter((folder) => matches(folder.name))
          .map((folder) => ({ key: `d:${folder.folder_id}`, kind: 'folder', folder }))
    const files: Row[] = listing.files
      .filter((file) => matches(file.name) && (!attention || needsAttention(file.state)))
      .map((file) => ({ key: `f:${file.file_id}`, kind: 'file', file }))
    return [...folders, ...files]
  }, [listing, filter, attention])

  const chosen = rows.filter((row) => selected.includes(row.key))
  const chosenFiles = chosen.flatMap((row) => (row.kind === 'file' ? [row.file] : []))
  const chosenFolders = chosen.flatMap((row) => (row.kind === 'folder' ? [row.folder] : []))

  // --------------------------------------------------------------- actions

  const go = (next: Place) => {
    setFilter('')
    setAttention(false)
    setPlace(next)
  }
  const openFolder = (id: string | null) => {
    if (place.kind === 'tree') go({ ...place, folderId: id })
  }

  async function act(action: () => Promise<unknown>, done?: string) {
    try {
      await action()
      if (done) toast.success(done)
    } catch (caught) {
      toast.error(errorText(caught, 'That did not work'))
    }
    refreshAll()
  }

  async function move(items: { fileIds: string[]; folderIds: string[] }, to: string | null) {
    if (!treeName) return
    setMoving(null)
    await act(() => moveDriveItems(treeName, items, to))
    setSelected([])
  }

  function newFolder() {
    if (!treeName) return
    let name = ''
    modal.confirm({
      title: 'New folder',
      icon: <FolderAddOutlined />,
      content: (
        <Input
          autoFocus
          placeholder="Untitled folder"
          aria-label="Folder name"
          onChange={(event) => {
            name = event.target.value
          }}
        />
      ),
      okText: 'Create',
      onOk: () => act(() => createDriveFolder(treeName, folderId, name || 'Untitled folder')),
    })
  }

  function renameFolder(folder: DriveFolder) {
    let name = folder.name
    modal.confirm({
      title: 'Rename folder',
      icon: <EditOutlined />,
      content: (
        <Input
          autoFocus
          defaultValue={folder.name}
          aria-label="Folder name"
          onChange={(event) => {
            name = event.target.value
          }}
        />
      ),
      okText: 'Rename',
      onOk: () => act(() => renameDriveFolder(folder.folder_id, name)),
    })
  }

  function remove(files: DriveFile[], folders: DriveFolder[]) {
    if (!treeName) return
    const tree = treeName
    const inside = folders.reduce((total, folder) => total + folder.file_count, 0)
    const count = files.length + folders.length
    if (count === 0) return
    modal.confirm({
      title: `Delete ${count} ${count === 1 ? 'item' : 'items'}?`,
      content:
        (folders.length
          ? `Folders are deleted with everything in them${inside ? ` (${inside} files at the top level)` : ''}. `
          : '') +
        'The files are deleted and stop being searchable.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () =>
        act(async () => {
          if (files.length) await deleteDriveFiles(tree, files.map((file) => file.file_id))
          for (const folder of folders) await deleteDriveFolder(folder.folder_id)
          setSelected([])
        }, 'Deleted'),
    })
  }

  function index(files: DriveFile[] | null) {
    if (!treeName) return
    const force = !!files?.some((file) => file.state === 'failed' || file.state === 'unsupported')
    void act(async () => {
      const result = await indexDriveFiles(
        treeName,
        files ? files.map((file) => file.file_id) : null,
        force,
      )
      if (result.status === 'nothing') toast.info('Everything here is already indexed')
      else toast.success(`${result.files} ${result.files === 1 ? 'file' : 'files'} ${result.status === 'queued' ? 'queued' : 'indexing'}`)
    })
  }

  function visibility(files: DriveFile[], value: Visibility) {
    const ids = files.flatMap((file) => (file.document_id && file.visibility !== value ? [file.document_id] : []))
    if (ids.length) void act(() => setVisibilityInBulk(ids, value), value === 'public' ? 'Made public' : 'Made private')
  }

  // Everyone decides for their own documents, and an admin for anyone's: the only trees
  // anyone can open here are ones they may change.
  const canPublish = chosenFiles.some((file) => file.document_id && file.visibility === 'private')
  const canUnpublish = chosenFiles.some((file) => file.visibility === 'public')

  function upload(files: File[]) {
    if (!ownTree || files.length === 0) return
    void uploads.upload(files, folderId)
  }

  // ------------------------------------------------------------ drag & drop

  function dragStart(event: DragEvent, row: Row) {
    const keys = selected.includes(row.key) ? selected : [row.key]
    if (!selected.includes(row.key)) setSelected([row.key])
    const items = {
      fileIds: keys.filter((key) => key.startsWith('f:')).map((key) => key.slice(2)),
      folderIds: keys.filter((key) => key.startsWith('d:')).map((key) => key.slice(2)),
    }
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(items))
    event.dataTransfer.effectAllowed = 'move'
  }

  /** Handlers that make an element a place to drop items (and, on the list, files). */
  function dropTarget(to: string | null, acceptFiles = false) {
    return {
      onDragOver: (event: DragEvent) => {
        const types = event.dataTransfer.types
        if (types.includes(DRAG_TYPE) || (acceptFiles && ownTree && types.includes('Files'))) {
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = types.includes(DRAG_TYPE) ? 'move' : 'copy'
          if (acceptFiles) setDropping(true)
        }
      },
      onDragLeave: () => acceptFiles && setDropping(false),
      onDrop: (event: DragEvent) => {
        setDropping(false)
        const raw = event.dataTransfer.getData(DRAG_TYPE)
        if (raw) {
          event.preventDefault()
          event.stopPropagation()
          const items = JSON.parse(raw) as { fileIds: string[]; folderIds: string[] }
          if (to !== null && items.folderIds.includes(to)) return
          void move(items, to)
          return
        }
        if (acceptFiles && ownTree && event.dataTransfer.files.length) {
          event.preventDefault()
          upload([...event.dataTransfer.files])
        }
      },
    }
  }

  // ------------------------------------------------------------- the menu

  const single = chosen.length === 1 ? chosen[0] : null
  const menuItems: MenuProps['items'] = [
    ...(single?.kind === 'folder'
      ? [
          { key: 'open-folder', icon: <FolderOutlined />, label: 'Open' },
          { key: 'rename', icon: <EditOutlined />, label: 'Rename' },
        ]
      : []),
    ...(single?.kind === 'file' && single.file.document_id
      ? [
          { key: 'open', icon: <ExportOutlined />, label: 'Open in a new tab' },
          { key: 'download', icon: <DownloadOutlined />, label: 'Download' },
        ]
      : []),
    ...(chosen.length ? [{ key: 'move', icon: <SwapOutlined />, label: 'Move to…' }] : []),
    ...(chosenFiles.some((file) => file.state !== 'indexed' && file.state !== 'duplicate')
      ? [{ key: 'index', icon: <SyncOutlined />, label: 'Index' }]
      : []),
    ...(canPublish ? [{ key: 'public', icon: <GlobalOutlined />, label: 'Make public' }] : []),
    ...(canUnpublish ? [{ key: 'private', icon: <LockOutlined />, label: 'Make private' }] : []),
    ...(chosen.length
      ? [{ type: 'divider' as const }, { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true }]
      : []),
  ]

  const onMenu: MenuProps['onClick'] = ({ key }) => {
    setMenu(null)
    if (key === 'open-folder' && single?.kind === 'folder') openFolder(single.folder.folder_id)
    if (key === 'rename' && single?.kind === 'folder') renameFolder(single.folder)
    if (key === 'open' && single?.kind === 'file') openDocument(single.file.document_id!)
    if (key === 'download' && single?.kind === 'file') window.location.assign(documentFileUrl(single.file.document_id!))
    if (key === 'move') setMoving({ fileIds: chosenFiles.map((file) => file.file_id), folderIds: chosenFolders.map((folder) => folder.folder_id) })
    if (key === 'index') index(chosenFiles.filter((file) => file.state !== 'indexed' && file.state !== 'duplicate'))
    if (key === 'public') visibility(chosenFiles, 'public')
    if (key === 'private') visibility(chosenFiles, 'private')
    if (key === 'delete') remove(chosenFiles, chosenFolders)
  }

  // ------------------------------------------------------------- columns

  const columns: TableColumnsType<Row> = [
    {
      key: 'name',
      title: 'Name',
      sorter: (a, b) => nameOf(a).localeCompare(nameOf(b)),
      render: (_, row) =>
        row.kind === 'folder' ? (
          <button type="button" className="drive-name drive-folder-name" onClick={() => openFolder(row.folder.folder_id)}>
            <FolderFilled className="drive-folder-icon" aria-hidden="true" />
            {row.folder.name}
          </button>
        ) : (
          <span className="drive-name">
            {fileIcon(row.file)}
            <span className="drive-file-name">{row.file.name}</span>
          </span>
        ),
    },
    {
      key: 'visibility',
      title: 'Visibility',
      width: 120,
      filters: [
        { text: 'Public', value: 'public' },
        { text: 'Private', value: 'private' },
      ],
      onFilter: (value, row) => row.kind === 'file' && row.file.visibility === value,
      render: (_, row) => (row.kind === 'file' ? <VisibilityTag visibility={row.file.visibility} /> : null),
    },
    {
      key: 'state',
      title: 'Status',
      width: 170,
      render: (_, row) =>
        row.kind === 'file' ? <StateTag state={row.file.state as RowState} error={row.file.error} /> : null,
    },
    {
      key: 'pages',
      title: 'Pages',
      width: 80,
      align: 'right',
      render: (_, row) =>
        row.kind === 'file' && row.file.pages ? `${row.file.pages_approximate ? '~' : ''}${row.file.pages}` : '—',
    },
    {
      key: 'modified',
      title: 'Modified',
      width: 130,
      sorter: (a, b) => (modifiedOf(a) ?? '').localeCompare(modifiedOf(b) ?? ''),
      render: (_, row) => {
        const value = modifiedOf(row)
        return value ? new Date(value).toLocaleDateString() : '—'
      },
    },
    {
      key: 'size',
      title: 'Size',
      width: 90,
      align: 'right',
      render: (_, row) => (row.kind === 'file' ? formatSize(row.file.size) : '—'),
    },
  ]

  // ------------------------------------------------------------- the rail

  const railTree = useMemo<TreeDataNode[]>(() => {
    const build = (folders: DriveFolder[]): TreeDataNode[] =>
      folders.map((folder) => ({
        key: folder.folder_id,
        title: (
          <span className="rail-folder" {...dropTarget(folder.folder_id)}>
            {folder.name}
          </span>
        ),
        icon: <FolderOutlined />,
        children: build(folder.folders),
      }))
    return build(tree?.folders ?? [])
    // dropTarget closes over the current tree; rebuilding with it is what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, treeName])

  const rootLabel =
    treeName === 'me'
      ? 'My documents'
      : (users.find((other) => other.user_id === treeName)?.username ?? 'Documents')

  const railEntry = (key: string, icon: ReactNode, label: string, active: boolean, onClick: () => void, extra?: ReactNode) => (
    <div key={key}>
      <button
        type="button"
        className={`rail-entry${active ? ' active' : ''}`}
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        {...(active && place.kind === 'tree' ? dropTarget(null) : {})}
      >
        <span aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </button>
      {extra}
    </div>
  )

  const folderTree =
    place.kind === 'tree' && railTree.length ? (
      <Tree
        className="rail-tree"
        showIcon
        blockNode
        defaultExpandAll
        treeData={railTree}
        selectedKeys={folderId ? [folderId] : []}
        onSelect={(keys) => keys.length && openFolder(String(keys[0]))}
      />
    ) : null

  const rail = (
    <nav className="drive-rail" aria-label="Folders">
      <Dropdown
        disabled={!ownTree}
        menu={{
          items: [
            { key: 'upload', icon: <CloudUploadOutlined />, label: 'Upload files' },
            { key: 'folder', icon: <FolderAddOutlined />, label: 'New folder' },
          ],
          onClick: ({ key }) => (key === 'upload' ? fileInput.current?.click() : newFolder()),
        }}
      >
        <Button type="primary" size="large" icon={<PlusOutlined />} className="drive-new" disabled={!ownTree && place.kind !== 'tree'}>
          New
        </Button>
      </Dropdown>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        hidden
        data-testid="drive-file-input"
        onChange={(event) => {
          upload([...(event.target.files ?? [])])
          event.target.value = ''
        }}
      />

      {railEntry('me', <HomeOutlined />, 'My documents', treeName === 'me', () => go({ kind: 'tree', tree: 'me', folderId: null }), treeName === 'me' ? folderTree : null)}
      {railEntry('public', <GlobalOutlined />, 'Public', place.kind === 'public', () => go({ kind: 'public' }))}
      {isAdmin && users.some((other) => other.user_id !== user?.user_id) ? (
        <div className="rail-group">
          <Typography.Text type="secondary" className="rail-group-title">
            <TeamOutlined /> Users
          </Typography.Text>
          {users
            .filter((other) => other.user_id !== user?.user_id)
            .map((other) =>
              railEntry(other.user_id, <FolderOutlined />, other.username, treeName === other.user_id, () => go({ kind: 'tree', tree: other.user_id, folderId: null }), treeName === other.user_id ? folderTree : null),
            )}
        </div>
      ) : null}

      <div className="drive-summary" aria-label="Summary">
        {listing && listing.not_indexed > 0 && place.kind === 'tree' ? (
          <Button size="small" icon={<SyncOutlined />} onClick={() => index(null)} className="drive-index-now">
            Index now ({listing.not_indexed})
          </Button>
        ) : null}
        <div>{indexed.length} {indexed.length === 1 ? 'document' : 'documents'}</div>
        <div>{passages.toLocaleString()} passages</div>
        {troubled ? (
          <button type="button" className="drive-attention" onClick={() => setAttention(!attention)} aria-pressed={attention}>
            {troubled} need attention
          </button>
        ) : null}
      </div>
    </nav>
  )

  // ------------------------------------------------------------ the page

  const toolbar = (
    <div className="drive-toolbar">
      {place.kind === 'tree' ? (
        <Breadcrumb
          className="drive-breadcrumb"
          items={[
            {
              key: 'root',
              title: (
                <button type="button" className="crumb" onClick={() => openFolder(null)} {...dropTarget(null)}>
                  {rootLabel}
                </button>
              ),
            },
            ...(listing?.breadcrumb ?? []).map((crumb) => ({
              key: crumb.folder_id,
              title: (
                <button type="button" className="crumb" onClick={() => openFolder(crumb.folder_id)} {...dropTarget(crumb.folder_id)}>
                  {crumb.name}
                </button>
              ),
            })),
          ]}
        />
      ) : (
        <Typography.Title level={4} className="drive-title">
          Public documents
        </Typography.Title>
      )}
      <Space wrap>
        {chosen.length ? (
          <>
            <Typography.Text type="secondary">{chosen.length} selected</Typography.Text>
            <Button icon={<SwapOutlined />} onClick={() => setMoving({ fileIds: chosenFiles.map((file) => file.file_id), folderIds: chosenFolders.map((folder) => folder.folder_id) })}>
              Move to…
            </Button>
            {canPublish ? (
              <Button icon={<GlobalOutlined />} onClick={() => visibility(chosenFiles, 'public')}>
                Make public
              </Button>
            ) : null}
            {canUnpublish ? (
              <Button icon={<LockOutlined />} onClick={() => visibility(chosenFiles, 'private')}>
                Make private
              </Button>
            ) : null}
            <Button danger icon={<DeleteOutlined />} onClick={() => remove(chosenFiles, chosenFolders)}>
              Delete
            </Button>
          </>
        ) : null}
        <Input.Search
          allowClear
          placeholder="Filter by name"
          aria-label="Filter by name"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="drive-filter"
        />
        <Tooltip title="Refresh">
          <Button icon={<ReloadOutlined />} aria-label="Refresh" onClick={refreshAll} />
        </Tooltip>
        <Segmented
          aria-label="Layout"
          value={layout}
          onChange={(value) => {
            setLayout(value as 'list' | 'grid')
            try {
              window.localStorage.setItem(LAYOUT_KEY, String(value))
            } catch {
              // Per browser only; not remembering it is fine.
            }
          }}
          options={[
            { value: 'list', icon: <BarsOutlined />, title: 'List' },
            { value: 'grid', icon: <AppstoreOutlined />, title: 'Grid' },
          ]}
        />
      </Space>
    </div>
  )

  const onRowContext = (event: React.MouseEvent, row: Row) => {
    event.preventDefault()
    if (!selected.includes(row.key)) setSelected([row.key])
    setMenu({ x: event.clientX, y: event.clientY })
  }

  const empty = (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        filter || attention
          ? 'Nothing here matches.'
          : ownTree
            ? 'Drop PDF or Word files here, or use New to upload them.'
            : 'This folder is empty.'
      }
    />
  )

  const list =
    layout === 'list' ? (
      <Table<Row>
        rowKey="key"
        size="middle"
        columns={columns}
        dataSource={rows}
        loading={!listing && !error}
        pagination={false}
        locale={{ emptyText: listing ? empty : ' ' }}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: (keys) => setSelected(keys.map(String)),
        }}
        onRow={(row) => ({
          draggable: true,
          onDragStart: (event) => dragStart(event, row),
          onContextMenu: (event) => onRowContext(event, row),
          onDoubleClick: () => {
            if (row.kind === 'folder') openFolder(row.folder.folder_id)
            else if (row.file.document_id) openDocument(row.file.document_id)
          },
          ...(row.kind === 'folder' ? dropTarget(row.folder.folder_id) : {}),
        })}
        className="drive-table"
      />
    ) : rows.length ? (
      <div className="drive-grid" role="list">
        {rows.map((row) => (
          <div
            key={row.key}
            role="listitem"
            className={`drive-card${selected.includes(row.key) ? ' selected' : ''}`}
            draggable
            onDragStart={(event) => dragStart(event, row)}
            onContextMenu={(event) => onRowContext(event, row)}
            onClick={(event) =>
              setSelected((current) =>
                event.metaKey || event.ctrlKey
                  ? current.includes(row.key)
                    ? current.filter((key) => key !== row.key)
                    : [...current, row.key]
                  : [row.key],
              )
            }
            onDoubleClick={() => {
              if (row.kind === 'folder') openFolder(row.folder.folder_id)
              else if (row.file.document_id) openDocument(row.file.document_id)
            }}
            {...(row.kind === 'folder' ? dropTarget(row.folder.folder_id) : {})}
          >
            <div className="drive-card-icon" aria-hidden="true">
              {row.kind === 'folder' ? <FolderFilled className="drive-folder-icon" /> : fileIcon(row.file)}
            </div>
            <Typography.Text ellipsis className="drive-card-name">
              {row.kind === 'folder' ? row.folder.name : row.file.name}
            </Typography.Text>
            {row.kind === 'file' ? (
              <Space size={4} wrap>
                <StateTag state={row.file.state as RowState} error={row.file.error} />
                <VisibilityTag visibility={row.file.visibility} />
              </Space>
            ) : null}
          </div>
        ))}
      </div>
    ) : (
      empty
    )

  return (
    <div className="drive">
      {rail}
      <section className={`drive-main${dropping ? ' dropping' : ''}`} {...dropTarget(folderId, true)}>
        {toolbar}
        {error ? <Alert type="error" showIcon title={error} className="page-alert" /> : null}
        {place.kind === 'public' ? (
          <PublicList
            documents={library.documents}
            isAdmin={isAdmin}
            onMakePrivate={(document) =>
              void act(() => setVisibilityInBulk([document.document_id], 'private'), `${document.filename} is private`)
            }
          />
        ) : (
          list
        )}
      </section>

      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClick={onMenu} onClose={() => setMenu(null)} />
      ) : null}

      <MoveDialog
        open={!!moving}
        rootName={rootLabel}
        folders={tree?.folders ?? []}
        movingFolderIds={moving?.folderIds ?? []}
        count={(moving?.fileIds.length ?? 0) + (moving?.folderIds.length ?? 0)}
        onCancel={() => setMoving(null)}
        onMove={(to) => moving && void move(moving, to)}
      />

      <UploadPanel
        rows={uploads.rows}
        onRetry={(row) => void uploads.retry(row)}
        onDismiss={uploads.dismiss}
        onShow={(row) => row.documentId && openDocument(row.documentId)}
      />
    </div>
  )
}

/**
 * The right-click menu, drawn at the pointer. Not an antd Dropdown: one opened by the
 * same right-click that should open it closes again at once.
 */
function ContextMenu({
  x,
  y,
  items,
  onClick,
  onClose,
}: {
  x: number
  y: number
  items: MenuProps['items']
  onClick: MenuProps['onClick']
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [onClose])
  // Keep it on screen near the right and bottom edges.
  const left = Math.min(x, window.innerWidth - 220)
  const top = Math.min(y, window.innerHeight - 320)
  return (
    <div ref={ref} className="drive-context-menu" style={{ left, top }}>
      <Menu items={items} onClick={onClick} selectable={false} />
    </div>
  )
}

/** Whether a file is public. Nothing for a file that is not indexed yet. */
function VisibilityTag({ visibility }: { visibility: DriveFile['visibility'] }) {
  if (visibility === 'public') {
    return (
      <Tooltip title="Anyone can find it, without logging in">
        <Tag color="blue" icon={<GlobalOutlined />} className="drive-visibility">
          Public
        </Tag>
      </Tooltip>
    )
  }
  if (visibility === 'private') {
    return (
      <Tag icon={<LockOutlined />} className="drive-visibility">
        Private
      </Tag>
    )
  }
  return <Typography.Text type="secondary">—</Typography.Text>
}

/**
 * Public documents: for an admin everyone's, for anyone else their own. Each says who
 * made it public and can be made private again; moving them is their owners' business.
 */
function PublicList({
  documents,
  isAdmin,
  onMakePrivate,
}: {
  documents: DocumentSummary[]
  isAdmin: boolean
  onMakePrivate: (document: DocumentSummary) => void
}) {
  const shared = documents.filter(
    (document) => document.visibility === 'public' && (isAdmin || document.is_mine),
  )
  return (
    <Table<DocumentSummary>
      rowKey="document_id"
      size="middle"
      pagination={false}
      dataSource={shared}
      locale={{
        emptyText: (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              isAdmin
                ? 'Nothing has been made public yet.'
                : 'None of your documents is public. Select some in My documents and choose Make public.'
            }
          />
        ),
      }}
      onRow={(document) => ({ onDoubleClick: () => openDocument(document.document_id) })}
      columns={[
        {
          key: 'name',
          title: 'Name',
          render: (_, document) => (
            <span className="drive-name">
              {document.file_type === 'docx' ? <FileWordOutlined className="drive-word" /> : <FilePdfOutlined className="drive-pdf" />}
              <span className="drive-file-name">{document.filename}</span>
            </span>
          ),
        },
        ...(isAdmin
          ? [{ key: 'owner', title: 'Owner', render: (_: unknown, document: DocumentSummary) => document.owner_username ?? '—' }]
          : []),
        {
          key: 'published-by',
          title: 'Published by',
          render: (_: unknown, document: DocumentSummary) => document.published_by_username ?? '—',
        },
        { key: 'pages', title: 'Pages', width: 80, align: 'right' as const, render: (_: unknown, document: DocumentSummary) => `${document.pages_approximate ? '~' : ''}${document.pages}` },
        {
          key: 'open',
          title: '',
          width: 220,
          render: (_: unknown, document: DocumentSummary) => (
            <Space size={0}>
              <Button size="small" icon={<LockOutlined />} onClick={() => onMakePrivate(document)}>
                Make private
              </Button>
              <Tooltip title="Open in a new tab">
                <Button type="text" size="small" aria-label={`Open ${document.filename}`} icon={<ExportOutlined />} onClick={() => openDocument(document.document_id)} />
              </Tooltip>
              <Tooltip title="Download">
                <Button type="text" size="small" aria-label={`Download ${document.filename}`} icon={<DownloadOutlined />} href={documentFileUrl(document.document_id)} />
              </Tooltip>
            </Space>
          ),
        },
      ]}
    />
  )
}

function nameOf(row: Row): string {
  return row.kind === 'folder' ? row.folder.name : row.file.name
}

function modifiedOf(row: Row): string | null {
  return row.kind === 'file' ? row.file.modified_at : null
}

function fileIcon(file: DriveFile) {
  return file.file_type === 'docx' ? (
    <FileWordOutlined className="drive-word" aria-hidden="true" />
  ) : (
    <FilePdfOutlined className="drive-pdf" aria-hidden="true" />
  )
}
