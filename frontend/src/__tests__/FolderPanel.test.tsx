// frontend/src/__tests__/FolderPanel.test.tsx
// Folder management moved out of the Indexing page and into the add-documents card on
// the Documents page, so these render it there. The behaviour under test is unchanged.

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddDocumentsCard } from '../components/AddDocumentsCard'
import type { Library } from '../hooks/useLibrary'
import { makeFolder, makeLibrary, makeStatus } from './fixtures'
import { renderWithProviders } from './helpers'

function show(library: Library = makeLibrary()) {
  renderWithProviders(<AddDocumentsCard library={library} onClose={vi.fn()} />)
  return library
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('folders indexed in place', () => {
  it('says that nothing is copied', () => {
    show()
    expect(screen.getAllByText(/nothing is copied/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/including the ones in subfolders/i)).toBeInTheDocument()
  })

  it('adds a folder by path', async () => {
    const library = show()
    await userEvent.type(screen.getByLabelText(/folder path/i), '/Users/you/Documents/manuals')
    await userEvent.click(screen.getByRole('button', { name: /add folder/i }))
    expect(library.addLibraryFolder).toHaveBeenCalledWith('/Users/you/Documents/manuals')
  })

  it('adds on Enter as well', async () => {
    const library = show()
    await userEvent.type(screen.getByLabelText(/folder path/i), '/data/pdfs{Enter}')
    expect(library.addLibraryFolder).toHaveBeenCalledWith('/data/pdfs')
  })

  it('cannot add an empty path', () => {
    show()
    expect(screen.getByRole('button', { name: /add folder/i })).toBeDisabled()
  })

  it('clears the box once the folder is accepted', async () => {
    show()
    const input = screen.getByLabelText(/folder path/i)
    await userEvent.type(input, '/data/pdfs{Enter}')
    expect(input).toHaveValue('')
  })

  it('keeps the path when it was rejected, so it can be corrected', async () => {
    show(makeLibrary({ addLibraryFolder: vi.fn().mockResolvedValue(false) }))
    const input = screen.getByLabelText(/folder path/i)
    await userEvent.type(input, '/typo{Enter}')
    expect(input).toHaveValue('/typo')
  })

  it('lists each folder with what it holds', () => {
    show(
      makeLibrary({
        folders: [
          makeFolder({
            path: '/documents',
            is_default: true,
            document_count: 3,
            indexed_documents: 3,
          }),
          makeFolder({ path: '/Users/you/manuals', document_count: 40, indexed_documents: 38 }),
        ],
      }),
    )
    expect(screen.getByText('/Users/you/manuals')).toBeInTheDocument()
    expect(screen.getByText(/40 documents on disk · 38 indexed/)).toBeInTheDocument()
    expect(screen.getByText('default')).toBeInTheDocument()
  })

  it('flags a folder it can no longer read', () => {
    show(
      makeLibrary({
        folders: [makeFolder({ path: '/Volumes/usb/manuals', readable: false, exists: false })],
      }),
    )
    expect(screen.getByText(/not readable/i)).toBeInTheDocument()
  })

  it('does not offer to remove the default folder', () => {
    show(makeLibrary({ folders: [makeFolder({ path: '/documents', is_default: true })] }))
    expect(screen.queryByRole('button', { name: /stop indexing/i })).toBeNull()
  })

  it('confirms before removing a folder, and says what it costs', async () => {
    const library = show(
      makeLibrary({
        folders: [makeFolder({ path: '/Users/you/manuals', indexed_documents: 38 })],
      }),
    )

    await userEvent.click(screen.getByRole('button', { name: /stop indexing/i }))
    expect(library.removeLibraryFolder).not.toHaveBeenCalled()
    expect(
      await screen.findByText(/38 documents will be removed from the index/i),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^remove$/i }))
    expect(library.removeLibraryFolder).toHaveBeenCalledWith('/Users/you/manuals')
  })

  it('cannot add or remove while a job runs', () => {
    show(
      makeLibrary({
        status: makeStatus({ status: 'running' }),
        folders: [makeFolder({ path: '/Users/you/manuals' })],
      }),
    )
    expect(screen.getByRole('button', { name: /stop indexing/i })).toBeDisabled()
  })
})
