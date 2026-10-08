// frontend/src/__tests__/DrivePage.test.tsx
// The document manager (spec 2026-10-08 §3): folders, uploads that index themselves,
// Index now, moves and deletes. The server's side has its own tests (test_drive.py).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as api from '../services/api'
import { asUser, givenDrive, makeDriveFile, renderApp } from './helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

const folder: api.DriveFolder = {
  folder_id: 'folder-1',
  name: 'Manuals',
  parent_id: null,
  file_count: 0,
  folders: [],
}

describe('the document manager', () => {
  it('lists folders first, then files with where each is in indexing', async () => {
    asUser()
    givenDrive(
      [
        // In the server's order: by name.
        makeDriveFile({ file_id: 'a', name: 'good.pdf', state: 'indexed' }),
        makeDriveFile({ file_id: 'c', name: 'later.docx', state: 'not_indexed', document_id: null }),
        makeDriveFile({ file_id: 'b', name: 'scan.pdf', state: 'unsupported', pages: null }),
      ],
      [folder],
    )
    renderApp('/drive')
    const table = await screen.findByRole('table')
    const rows = await within(table).findAllByRole('row')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Name'),
      expect.stringContaining('Manuals'),
      expect.stringContaining('good.pdf'),
      expect.stringContaining('later.docx'),
      expect.stringContaining('scan.pdf'),
    ])
    expect(within(table).getByText('Indexed')).toBeInTheDocument()
    expect(within(table).getByText('No text')).toBeInTheDocument()
    expect(within(table).getByText('Not indexed')).toBeInTheDocument()
  })

  it('offers Index now for what is not indexed, and asks for exactly that', async () => {
    asUser()
    givenDrive([makeDriveFile({ file_id: 'c', name: 'later.pdf', state: 'not_indexed', document_id: null })])
    const index = vi.spyOn(api, 'indexDriveFiles').mockResolvedValue({ status: 'started', files: 1 })
    renderApp('/drive')
    await userEvent.click(await screen.findByRole('button', { name: /index now \(1\)/i }))
    expect(index).toHaveBeenCalledWith('me', null, false)
  })

  it('uploads into the open folder and follows each file to indexed', async () => {
    asUser()
    givenDrive()
    const upload = vi.spyOn(api, 'uploadToDrive').mockImplementation(async (_files, _folder, progress) => {
      progress(50, 100)
      return { saved: ['a.pdf'], rejected: [], directory: '', files: [{ file_id: 'up-1', name: 'a.pdf' }], indexing: 'started' }
    })
    vi.spyOn(api, 'getIndexStatus').mockResolvedValue({ status: 'completed' } as api.IndexStatus)
    renderApp('/drive')
    await screen.findByRole('navigation', { name: 'Folders' })

    // The server lists the file as indexed by the time the panel asks.
    givenDrive([makeDriveFile({ file_id: 'up-1', name: 'a.pdf', state: 'indexed' })])
    const input = screen.getByTestId('drive-file-input') as HTMLInputElement
    const file = new File(['%PDF-1.4'], 'a.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })

    const panel = await screen.findByTestId('upload-panel')
    expect(upload).toHaveBeenCalledWith([file], null, expect.any(Function))
    await waitFor(() => expect(within(panel).getByText('Indexed')).toBeInTheDocument(), { timeout: 3000 })
    expect(within(panel).getByText('1 file indexed')).toBeInTheDocument()
  })

  it('reports a file the server would not take, by name', async () => {
    asUser()
    vi.spyOn(api, 'uploadToDrive').mockResolvedValue({
      saved: [],
      rejected: [{ filename: 'notes.txt', reason: 'not a PDF or Word (.docx) file' }],
      directory: '',
      files: [],
      indexing: null,
    })
    renderApp('/drive')
    await screen.findByRole('navigation', { name: 'Folders' })
    fireEvent.change(screen.getByTestId('drive-file-input'), {
      target: { files: [new File(['x'], 'notes.txt')] },
    })
    const panel = await screen.findByTestId('upload-panel')
    expect(await within(panel).findByText('Not uploaded')).toBeInTheDocument()
  })

  it('moves the selection into a folder picked in Move to…', async () => {
    asUser()
    givenDrive([makeDriveFile({ file_id: 'a', name: 'good.pdf' })], [folder])
    const move = vi.spyOn(api, 'moveDriveItems').mockResolvedValue()
    renderApp('/drive')
    const row = (await screen.findByText('good.pdf')).closest('tr')!
    await userEvent.click(within(row).getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /move to/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByText('Manuals'))
    await userEvent.click(within(dialog).getByRole('button', { name: /move here/i }))
    expect(move).toHaveBeenCalledWith('me', { fileIds: ['a'], folderIds: [] }, 'folder-1')
  })

  it('moves what is dragged onto a folder', async () => {
    asUser()
    givenDrive([makeDriveFile({ file_id: 'a', name: 'good.pdf' })], [folder])
    const move = vi.spyOn(api, 'moveDriveItems').mockResolvedValue()
    renderApp('/drive')
    const row = (await screen.findByText('good.pdf')).closest('tr')!
    const target = within(screen.getByRole('table')).getByText('Manuals').closest('tr')!
    const store = new Map<string, string>()
    const dataTransfer = {
      setData: (type: string, value: string) => store.set(type, value),
      getData: (type: string) => store.get(type) ?? '',
      get types() {
        return [...store.keys()]
      },
      files: [],
      effectAllowed: 'move',
      dropEffect: 'move',
    }
    fireEvent.dragStart(row, { dataTransfer })
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })
    await waitFor(() =>
      expect(move).toHaveBeenCalledWith('me', { fileIds: ['a'], folderIds: [] }, 'folder-1'),
    )
  })

  it('opens a folder and shows where it is', async () => {
    asUser()
    givenDrive([], [folder])
    renderApp('/drive')
    await userEvent.click(await screen.findByRole('button', { name: 'Manuals' }))
    await waitFor(() => expect(api.listDrive).toHaveBeenLastCalledWith('me', 'folder-1'))
  })

  it('deletes a folder only after asking', async () => {
    asUser()
    givenDrive([], [{ ...folder, file_count: 2 }])
    const remove = vi.spyOn(api, 'deleteDriveFolder').mockResolvedValue()
    renderApp('/drive')
    const row = (await screen.findByRole('button', { name: 'Manuals' })).closest('tr')!
    await userEvent.click(within(row).getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(remove).not.toHaveBeenCalled()
    const confirm = await screen.findByRole('dialog')
    expect(confirm).toHaveTextContent(/deleted with everything in them/i)
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('folder-1'))
  })

  it('deletes a file that was never indexed, after asking', async () => {
    asUser()
    givenDrive([makeDriveFile({ file_id: 'n', name: 'never.pdf', state: 'not_indexed', document_id: null })])
    const remove = vi.spyOn(api, 'deleteDriveFiles').mockResolvedValue()
    renderApp('/drive')
    const row = (await screen.findByText('never.pdf')).closest('tr')!
    await userEvent.click(within(row).getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    const confirm = await screen.findByRole('dialog')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('me', ['n']))
  })

  it('keeps the summary to three lines, with no charts', async () => {
    asUser()
    vi.spyOn(api, 'getDocuments').mockResolvedValue([])
    renderApp('/drive')
    const summary = await screen.findByLabelText('Summary')
    expect(summary).toHaveTextContent('0 documents')
    expect(summary).toHaveTextContent('0 passages')
    expect(document.querySelector('svg.donut, .chart')).toBeNull()
  })
})
